import qr from 'qr-image'
import dotenv from 'dotenv'
import Express from 'express'
import Buffers from './utils/Buffers'
import { existsSync, mkdirSync } from 'fs'
import SocketClient from './libs/SocketClient'
import logger from '@adiwajshing/baileys/lib/Utils/logger'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, useSingleFileAuthState } from '@adiwajshing/baileys'

import { XTMessages } from './types/XTFormatter'

dotenv && dotenv.config()

class AdoWhatsApp extends SocketClient {
    private dataStore: any
    private stateData: any

    public XT: number = 1
    public Client: any
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

        
        const { version } = await fetchLatestBaileysVersion()
        this.Log(`whatsapp web version: ${version.join('.')}`)

        const ConnectWhatsapp = async () => {
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

            this.Client.ev.on('connection.update', async (update: any) => {
                const { connection, lastDisconnect, qr } = update
                
                if ( this.QRCode !== qr ) {
                    this.QRCode = qr
                    this.Log('new qr code generated.')
                }

                if ( connection === 'open' ) {
                    this.loggedIn = true
                    this.Log('successfully connected to whatsapp.')
                }

                if ( connection === 'close' ) {
                    let shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut
                    
                    if ( shouldReconnect ) {
                        this.Log('reconnecting to whatsapp..')

                        await new Promise(resolve => setTimeout(resolve, 1_000))
                        await ConnectWhatsapp()
                    } else {
                        this.Log('connection closed.')
                        process.exit(1)
                    }
                }
            })

            this.Client.ev.on('creds.update', this.stateData.saveState)
            await this.InitializeEvents()
        }

        ConnectWhatsapp()
    }

    private async InitializeEvents() {
        if ( !this.Client?.ev ) return

        const SendPacket = (event: string, data: any) => {
            const DataHeaders = { xt: this.XT, id: this.ClientID }
            const DataSockets = { ...DataHeaders, event }

            this.Send(2, [ DataSockets, data ])
        }

        this.Client?.ev.on('messages.upsert', async (raw: any) => {
            let msg = raw.messages ? raw.messages[0] : null
            if ( !msg ) return

            const AttachmentPrefabs = (obj: string) => {
                return {
                    mime: msg.message[obj].mimetype,
                    size: msg.message[obj].size,
                    meta: {
                        width: msg.message[obj].width,
                        height: msg.message[obj].height,
                        url: msg.message[obj].url
                    },
                    raw: msg.message[obj]
                }
            }

            const MessageFormat = (): XTMessages => {
                return {
                    ts: Date.now(),
                    authorId: msg.key.participant || msg.key.remoteJid,
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

            switch (raw.type) {
                case 'notify':
                    return SendPacket('message', MessageFormat())
                default:
                    return
            }
        })

        this.Client?.ev.on('group-participants.update', async (raw: any) => {
            let { id, participants, action } = raw

            switch (action) {
                case 'add':
                    return SendPacket('threadMemberAdd', {
                        threadId: id, members: participants, raw: raw
                    })
                case 'remove':
                    return SendPacket('threadMemberLeft', {
                        threadId: id, members: participants, raw: raw
                    })
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

    private async getMessage(threadId: string, raw: any) {
        return await this.dataStore.loadMessage(threadId, raw.messages[0].key.id)
    }

    public Methods = {
        SendMessage: async (data: any) => {
            let [ threadId, message, reply, raw ] = data

            return await this.Client.sendMessage(threadId, { text: message }, {
                quoted: reply ? await this.getMessage(threadId, raw) : undefined
            })
        },

        SendImage: async (data: any) => {
            let [ threadId, path, raw, reply ] = data

            return await this.Client.sendMessage(threadId, {
                image: { url: path },
                mimetype: 'image/png'
            }, {
                quoted: reply ? await this.getMessage(threadId, raw) : undefined
            })
        },

        SendAudio: async (data: any) => {
            let [ threadId, path, raw, reply ] = data

            return await this.Client.sendMessage(threadId, {
                audio: { url: path },
                ptt: true, mimetype: 'audio/mp4'
            }, {
                quoted: reply ? await this.getMessage(threadId, raw) : undefined
            })
        },

        SendSticker: async (data: any) => {
            let [ threadId, path, raw, reply ] = data

            return await this.Client.sendMessage(threadId, {
                sticker: { url: path }, mimetype: 'image/webp'
            }, {
                quoted: reply ? await this.getMessage(threadId, raw) : undefined
            })
        },

        ReadThread: async (data: any) => {
            // TODO: implement
            return false
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
        if ( WhatsApp.XT === soc.xt && WhatsApp.Methods[methods] ) {
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
        .get('/api', async (req, res) => {
            let { method, data, key } = req.query

            if ( !method || !data || !key ) return res.json({ success: false, data: 'missing method or data or api key' })
            if ( key !== process.env.APIKEY ) return res.json({ success: false, data: 'invalid api key' })

            method = String(method)
            data = String(data).split(',')
            
            try {
                let blacklistPublicMethods = ['ev']
                if ( blacklistPublicMethods.includes(method) ) return res.json({ success: false, data: 'method not allowed' })

                //@ts-ignore
                let raw = await WhatsApp[method](...data)
                res.json({ success: true, data: raw })
            } catch (err) {
                res.json({ success: false, data: err })
            }
        })
        .all('*', (_, res) => res.end('wa.ado - ado project - shiro.eu.org'))
        .listen(WhatsApp.APIPort, () => WhatsApp.Log(`whatsapp api listening on port ${WhatsApp.APIPort}`))
}

MainEntry()