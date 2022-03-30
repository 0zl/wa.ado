import ws from 'ws'
import Buffers from '../utils/Buffers'
import { EventEmitter } from 'events'

export default class SocketClient extends EventEmitter {
    private SERVERIP: string | undefined
    private Socket: ws | null
    private SocketName: string | null
    private SubType: number | null

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

    public async Connect(): Promise<Boolean> {
        if ( !this.SERVERIP ) throw new Error('SERVERIP is not defined')

        try {
            this.Socket = new ws(`ws://${this.SERVERIP}`, { perMessageDeflate: false })

            this.Socket.on('open', () => this.Send(1, this.SubType))
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
            console.error(err)
            throw new Error('SocketClient: Failed to connect to server')
        }
    }
}