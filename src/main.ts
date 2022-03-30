import qr from 'qr-image'
import dotenv from 'dotenv'
import Express from 'express'
import { existsSync, mkdirSync } from 'fs'
import SocketClient from './libs/SocketClient'
import logger from '@adiwajshing/baileys/lib/Utils/logger'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, useSingleFileAuthState } from '@adiwajshing/baileys'

dotenv && dotenv.config()

class AdoWhatsApp extends SocketClient {
    private XT: number = 1
    private Client: any
    private closedCount: number = 0
    private dataStore: any
    private stateData: any

    public QRCode: string | null = null
    public APIPort: number = process.env.APIPORT ? +process.env.APIPORT : 3000
    public loggedIn: boolean = false

    constructor() {
        super('whatsapp', 3)
        this.setMaxListeners(0) // unlimited listeners, possible memory leak.
    }

    private async InitializeConnection() {
        this.stateData = useSingleFileAuthState('./session/auth.json')
        this.dataStore = makeInMemoryStore({ logger: logger.child({ level: 'debug', stream: 'store' }) })

        this.dataStore.readFromFile('./session/store.json')
        setInterval(() => this.dataStore.writeToFile('./session/store.json'), 10_000)

        const ConnectWhatsapp = async () => {
            if ( this.Client ) this.Client.end()

            const { version } = await fetchLatestBaileysVersion()
            this.Log(`whatsapp web version: ${version.join('.')}`)

            this.Client = makeWASocket({
                version,
                printQRInTerminal: false,
                logger: logger.child({ level: 'warn' }),
                auth: this.stateData.state,
                getMessage: async key => {
                    return { conversation: 'nyan' }
                }
            })

            this.dataStore.bind(this.Client.ev)

            this.Client.ev.on('connection.update', (update: any) => {
                const { connection, lastDisconnect, qr } = update
                
                if ( connection === 'close' ) {
                    this.closedCount++

                    if ( this.closedCount <= 5 ) {
                        const shouldReconnect = lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                        this.Log('connection closed reason:', lastDisconnect.error.output.payload.message) // why boom?

                        if ( shouldReconnect ) {
                            this.Log('reconnecting..')
                            ConnectWhatsapp()
                        }
                    } else {
                        this.Log('too many connection closes, stopping..')
                        process.exit(1)
                    }
                }

                if ( connection === 'open' ) {
                    this.loggedIn = true
                    this.closedCount = 0
                    this.Log('successfully connected to whatsapp.')
                }

                if ( this.QRCode !== qr ) {
                    this.QRCode = qr
                    this.Log('new qr code generated.')
                }
            })

            this.Client.ev.on('creds.update', this.stateData.saveState)
        }

        ConnectWhatsapp()
    }

    public async Initializer() {
        await this.Connect()

        this.Log('initializing whatsapp client..')
        this.InitializeConnection()
    }
}

const MainEntry = async () => {
    console.log('ado - whatsapp client')

    if ( !existsSync('session') ) mkdirSync('session')
    
    const WhatsApp = new AdoWhatsApp()
    await WhatsApp.Initializer()

    Express()
        .get('/qr', async (_, res) => {
            if ( WhatsApp.QRCode && !WhatsApp.loggedIn )
                return res
                    .contentType('png')
                    .send(qr.imageSync(WhatsApp.QRCode, { type: 'png' }))

            res.redirect('/')
        })
        .all('*', (_, res) => res.end('wa.ado - ado project - shiro.eu.org'))
        .listen(WhatsApp.APIPort, () => WhatsApp.Log(`whatsapp api listening on port ${WhatsApp.APIPort}`))
}

MainEntry()