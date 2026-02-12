import axios, { type AxiosInstance } from 'axios';
import { logger, maskPhone } from '../monitoring/logger.js';

export interface OtpBlueSendRequest {
  contact: string;
  code: string;
  sender: string;
  language?: string;
}

export interface OtpBlueSuccessResponse {
  success: true;
  message: string;
  message_id: string;
  recipient: string;
  status: 'delivered';
}

export interface OtpBlueFailureResponse {
  success: false;
  code: number;
  contact: string;
  message: string;
  status: 'failed';
}

export type OtpBlueResponse = OtpBlueSuccessResponse | OtpBlueFailureResponse;

export class OtpBlueClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, timeoutMs: number) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async sendOtp(request: OtpBlueSendRequest, apiKey: string): Promise<OtpBlueResponse> {
    const startMs = Date.now();
    try {
      const response = await this.http.post<OtpBlueSuccessResponse>('', request, {
        headers: { Authorization: apiKey },
      });

      logger.debug({
        messageId: response.data.message_id,
        contact: maskPhone(request.contact),
        status: response.data.status,
        latencyMs: Date.now() - startMs,
      }, 'OTP Blue API success');

      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 400 && error.response?.data) {
        const failureData = error.response.data as OtpBlueFailureResponse;

        logger.debug({
          contact: maskPhone(request.contact),
          errorCode: failureData.code,
          errorMessage: failureData.message,
          latencyMs: Date.now() - startMs,
        }, 'OTP Blue API failure');

        return failureData;
      }

      // Network/timeout errors
      logger.error({
        contact: maskPhone(request.contact),
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startMs,
      }, 'OTP Blue API network error');

      throw error;
    }
  }
}
