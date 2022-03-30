import ws from 'ws'
import Buffers from '../utils/Buffers'
import { EventEmitter } from 'events'

export default class SocketClient extends EventEmitter {
    private SERVERPORT: number
    private Socket: ws | null
    private SocketName: string | null
    private SubType: number | null

    constructor(SocketName: string, SubscribeType: number) {
        super()

        this.setMaxListeners(0) // unlimited listeners, possible memory leak.
        this.SERVERPORT = process.env.SVPORT ? +process.env.SVPORT : 0

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
}