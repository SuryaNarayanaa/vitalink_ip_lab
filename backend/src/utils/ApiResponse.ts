import { StatusCodes } from "http-status-codes";

export default class ApiResponse{
    statusCode: StatusCodes
    data: any
    message: string
    success: boolean
    constructor(statusCode: StatusCodes,message="Success", data:any = null){
        this.statusCode = statusCode;
        this.data = data;
        this.message = message;
        this.success = this.statusCode < 400;
    }
}
