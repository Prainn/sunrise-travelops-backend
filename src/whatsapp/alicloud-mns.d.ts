declare module '@alicloud/mns' {
  class MnsClient {
    constructor(
      accountId: string,
      options: {
        endpoint: string;
        accessKeyId: string;
        accessKeySecret: string;
        securityToken: string;
        secure: boolean;
        readTimeout: number;
        connectTimeout: number;
      },
    );
    receiveMessage(
      queueName: string,
      waitSeconds: number,
    ): Promise<{ body?: { MessageBody?: string; ReceiptHandle?: string } }>;
    deleteMessage(queueName: string, receiptHandle: string): Promise<unknown>;
  }
  export = MnsClient;
}
