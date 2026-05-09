declare module "qrcode" {
  export type QRCodeToDataURLOptions = {
    margin?: number;
    width?: number;
    [key: string]: unknown;
  };

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;

  const QRCode: {
    toDataURL: typeof toDataURL;
  };

  export default QRCode;
}

declare module "nodemailer" {
  export type SendMailOptions = Record<string, unknown>;
  export type SentMessageInfo = {
    messageId?: string;
    response?: string;
    accepted?: unknown[];
    rejected?: unknown[];
    [key: string]: unknown;
  };
  export type Transporter = {
    sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
    verify(): Promise<boolean>;
  };

  export function createTransport(options: Record<string, unknown>): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}

declare module "mailparser" {
  export type AddressObject = {
    text?: string;
    value?: Array<{
      address?: string;
      name?: string;
      group?: Array<{ address?: string; name?: string }>;
    }>;
    html?: string;
  };

  export type ParsedHeaders = {
    get(name: string): unknown;
    has?(name: string): boolean;
    [Symbol.iterator]?(): IterableIterator<[string, unknown]>;
  };

  export type ParsedMail = {
    subject?: string;
    text?: string;
    html?: string | false;
    from?: AddressObject;
    to?: AddressObject | AddressObject[];
    cc?: AddressObject | AddressObject[];
    bcc?: AddressObject | AddressObject[];
    date?: Date;
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    headers: ParsedHeaders;
    attachments?: unknown[];
    [key: string]: unknown;
  };

  export function simpleParser(source: unknown, options?: Record<string, unknown>): Promise<ParsedMail>;
}

declare module "ping-email" {
  export type PingEmailOptions = {
    port?: number;
    fqdn?: string;
    sender?: string;
    timeout?: number;
    attempts?: number;
    ignoreSMTPVerify?: boolean;
    debug?: boolean;
    [key: string]: unknown;
  };

  export type PingEmailResult = {
    valid?: boolean;
    success?: boolean;
    message?: string;
    details?: string;
    catchAll?: boolean;
    isCatchAll?: boolean;
    [key: string]: unknown;
  };

  export class PingEmail {
    constructor(options?: PingEmailOptions);
    ping(email: string): Promise<PingEmailResult>;
  }
}
