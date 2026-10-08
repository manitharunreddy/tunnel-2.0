export enum MessageType {
  REGISTER = 'REGISTER',
  REGISTER_ACK = 'REGISTER_ACK',
  PING = 'PING',
  PONG = 'PONG',
  OPEN = 'OPEN',
  OPEN_ACK = 'OPEN_ACK',
  DATA = 'DATA',
  CLOSE = 'CLOSE',
  ERROR = 'ERROR',
}

export interface RegisterMessage {
  type: MessageType.REGISTER;
  agentId: string;
  agentSecret: string;
}

export interface RegisterAckMessage {
  type: MessageType.REGISTER_ACK;
  success: boolean;
  message?: string;
}

export interface PingMessage {
  type: MessageType.PING;
}

export interface PongMessage {
  type: MessageType.PONG;
}

export interface OpenMessage {
  type: MessageType.OPEN;
  connectionId: string;
  host: string;
  port: number;
}

export interface OpenAckMessage {
  type: MessageType.OPEN_ACK;
  connectionId: string;
  success: boolean;
  message?: string;
}

export interface DataMessage {
  type: MessageType.DATA;
  connectionId: string;
  data: string; // Base64 encoded or binary string, we can use binary WS frames, but JSON with Base64 is easier for MVP
}

export interface CloseMessage {
  type: MessageType.CLOSE;
  connectionId: string;
}

export interface ErrorMessage {
  type: MessageType.ERROR;
  connectionId: string;
  message: string;
}

export type TunnelMessage =
  | RegisterMessage
  | RegisterAckMessage
  | PingMessage
  | PongMessage
  | OpenMessage
  | OpenAckMessage
  | DataMessage
  | CloseMessage
  | ErrorMessage;
