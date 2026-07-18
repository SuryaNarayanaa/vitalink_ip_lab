import {StatusCodes} from 'http-status-codes'

export default class ApiError extends Error {
    statusCode: StatusCodes
    data: null
    success: boolean
    constructor(statusCode: StatusCodes, message: string = "Something went wrong") {
        super(message)
        this.statusCode = statusCode
        this.data = null
        this.success = false
    }
}
