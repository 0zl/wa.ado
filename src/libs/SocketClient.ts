import ws from 'ws'
import Buffers from '../utils/Buffers'
import { EventEmitter } from 'events'

export default class SocketClient extends EventEmitter {
    private SERVERIP: string | undefined
    private Socket: ws | null
    private SocketName: string | null
    private SubType: number | null
    private IsReconnecting: boolean = false

    constructor(SocketName: string, SubscribeType: number) {
        super()

        this.setMaxListeners(0) // unlimited listeners, possible memory leak.
        this.SERVERIP = process.env.SVIP

        this.Socket = null
        this.SocketName = SocketName
        this.SubType = SubscribeType
    }

    public Send(type: number, data: any) {
        if ( this.Socket?.readyState === ws.OPEN ) {
            this.Socket.send(
                Buffers.dataToBuffer([ type, data ])
            )
        }
    }

    public Log(...args: any) {
        if ( this.Socket?.readyState === ws.OPEN ) {
            this.Send(0, [`${this.SocketName}:`, ...args])
        }
    }

    private async Reconnect(): Promise<boolean> {
        let connected = false
        let count = 0
        
        return new Promise(async resolve => {
            while ( !connected ) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000))
                    
                    this.IsReconnecting = false
                    connected = await this.Connect()
                    
                    console.clear()
                    console.log('reconnected.')
                    
                    if ( connected ) resolve(true)
                } catch (e) {
                    count++
                    if ( count > 10 ) throw new Error('SocketClient: Failed to reconnect to server')
    
                    console.log('failed to reconnect, retrying..')
                }
            }
        })
    }

    public async Connect(): Promise<boolean> {
        if ( !this.SERVERIP ) throw new Error('SERVERIP is not defined')

        try {
            this.Socket = new ws(`ws://${this.SERVERIP}`, { perMessageDeflate: false })

            this.Socket.on('open', () => this.Send(1, this.SocketName))

            this.Socket.on('close', async () => {
                console.log('server closed, retrying..')

                this.IsReconnecting = true
                await this.Reconnect()
            })

            this.Socket.on('error', (e: Error) => {
                console.log(e)
            })

            this.Socket.on('message', payload => {
                let [ sub ] = Buffers.bufferToData(payload)

                if ( sub === this.SubType ) {
                    this.emit('message', payload)
                }
            })

            const checkReadyState = () => this.Socket?.readyState === ws.OPEN

            return new Promise(async resolve => {
                while ( this.Socket?.readyState === ws.CONNECTING ) {
                    await new Promise(resolve => setTimeout(resolve, 100))
                    if ( checkReadyState() ) resolve(true)
                }
            })
        } catch (err) {
            if ( this.IsReconnecting ) {
                return await this.Reconnect()
            }

            console.error(err)
            throw new Error('SocketClient: Failed to connect to server')
        }
    }
}