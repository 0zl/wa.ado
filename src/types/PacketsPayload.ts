export default interface PacketsPayload {
    soc: {
        xt: number
        id: number
    }
    methods: string
    data: any
}