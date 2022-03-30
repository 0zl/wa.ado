export default {
    dataToBuffer: (data: any): Buffer => {
        if ( typeof data === 'string' )
            return Buffer.from(data, 'utf8')
        else if ( Buffer.isBuffer(data) )
            return data;
        else
            return Buffer.from(JSON.stringify(data), 'utf8')
    },

    bufferToData: (buffer: Buffer): any => {
        if ( buffer.length === 0 ) return null

        if ( buffer[0] === 0 )
            return buffer.toString('utf8', 1)
        else
            return JSON.parse(buffer.toString('utf8'))
    }
}