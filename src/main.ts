import qr from 'qr-image'
import dotenv from 'dotenv'
import Express from 'express'
import Buffers from './utils/Buffers'
import { existsSync, mkdirSync } from 'fs'
import SocketClient from './libs/SocketClient'
import logger from '@adiwajshing/baileys/lib/Utils/logger'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, useSingleFileAuthState } from '@adiwajshing/baileys'

import { XTMessages } from './types/XTFormatter'
import PacketsPayload from './types/PacketsPayload'

dotenv && dotenv.config()

class AdoWhatsApp extends SocketClient {
    private Client: any
    private closedCount: number = 0
    private dataStore: any
    private stateData: any

    public XT: number = 1
    public ClientID: number = ~~(Math.random() * 100000)

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
            await this.InitializeEvents()
        }

        ConnectWhatsapp()
    }

    private async InitializeEvents() {
        if ( !this.Client?.ev ) return

        this.Client?.ev.on('messages.upsert', async (raw: any) => {
            let msg = raw.messages ? raw.messages[0] : null
            if ( !msg ) return

            const AttachmentPrefabs = (obj: string) => {
                return {
                    mime: msg.message[obj].mime,
                    size: msg.message[obj].size,
                    meta: {
                        width: msg.message[obj].width,
                        height: msg.message[obj].height,
                        url: msg.message[obj].url
                    },
                    raw: msg.message[obj].raw
                }
            }

            const MessageFormat = (): XTMessages => {
                return {
                    ts: Date.now(),
                    authorId: msg.key.participiant || msg.key.remoteJid,
                    threadId: msg.key.remoteJid,
                    messages: msg.message ? {
                        text: msg.message.conversation || null,
                        attachment: msg.message.imageMessage ? {
                            type: 'image',
                            ...AttachmentPrefabs('imageMessage')
                        } : msg.message.videoMessage ? {
                            type: 'video',
                            ...AttachmentPrefabs('videoMessage')
                        } : msg.message.stickerMessage ? {
                            type: 'sticker',
                            ...AttachmentPrefabs('stickerMessage')
                        } : null
                    } : null,
                    raw: raw
                }
            }

            const SendPacket = (event: string, data: any) => {
                const DataHeaders = { xt: this.XT, id: this.ClientID }
                const DataSockets = { ...DataHeaders, event }

                this.Send(2, [ DataSockets, data ])
            }

            switch (raw.type) {
                case 'notify':
                    return SendPacket('message', MessageFormat())
                default:
                    return
            }
        })
    }

    public async Initializer() {
        await this.Connect()

        this.Log('initializing whatsapp client..')
        this.InitializeConnection()
    }

    public Methods = {
        SendMessage: async (data: any) => {
            let [ threadId, message, reply, raw ] = data
            const quoteMessage = await this.dataStore.loadMessage(threadId, raw.messages[0].key.id)

            return await this.Client.sendMessage(threadId, { text: message }, {
                quoted: reply ? quoteMessage : undefined
            })
        }
    }
}

const MainEntry = async () => {
    console.log('ado - whatsapp client')

    if ( !existsSync('session') ) mkdirSync('session')
    
    const WhatsApp = new AdoWhatsApp()
    await WhatsApp.Initializer()

    WhatsApp.on('message', async (raw: Buffer) => {
        const payload = Buffers.bufferToData(raw)

        const [type, packets] = payload // unsued type, but it's there. (for now)
        const [soc, methods, data] = packets
        
        //@ts-ignore
        if ( WhatsApp.XT === soc.xt && WhatsApp.ClientID === soc.id && WhatsApp.Methods[methods] ) {
            //@ts-ignore
            await WhatsApp.Methods[methods](data)
        }
    })

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