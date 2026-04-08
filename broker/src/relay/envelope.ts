import { Encoder, Decoder } from 'cbor-x';

const enc = new Encoder({ useRecords: false, mapsAsObjects: true });
const dec = new Decoder({ mapsAsObjects: true });

export type EnvelopeType =
  | 'data' | 'stream_open' | 'stream_close' | 'stream_error'
  | 'connection_request' | 'connection_accept'
  | 'heartbeat' | 'heartbeat_ack' | 'server_status'
  | 'register' | 'registered'
  | 'signal_offer' | 'signal_answer' | 'ice_candidate' | 'signal_complete';

export type Service = 'pb' | 'api' | 'app';

export interface Envelope {
  type: EnvelopeType;
  client_id: string;
  service?: Service | undefined;
  stream_id?: number | undefined;
  flags?: number | undefined;
  [k: string]: unknown; // control frames carry arbitrary extra fields
}

const VERSION = 0x01;

export function encodeFrame(env: Envelope, payload: Buffer = Buffer.alloc(0)): Buffer {
  const envBuf = enc.encode(env) as Buffer;
  if (envBuf.length > 0xffff) throw new Error('envelope too large');
  const out = Buffer.allocUnsafe(3 + envBuf.length + payload.length);
  out[0] = VERSION;
  out.writeUInt16LE(envBuf.length, 1);
  envBuf.copy(out, 3);
  payload.copy(out, 3 + envBuf.length);
  return out;
}

export function decodeFrame(frame: Buffer): { env: Envelope; payload: Buffer } {
  if (frame.length < 3) throw new Error('frame truncated');
  if (frame[0] !== VERSION) throw new Error(`unsupported version ${frame[0]}`);
  const envLen = frame.readUInt16LE(1);
  if (frame.length < 3 + envLen) throw new Error('frame truncated');
  const envBuf = frame.subarray(3, 3 + envLen);
  const env = dec.decode(envBuf) as Envelope;
  const payload = frame.subarray(3 + envLen);
  return { env, payload };
}

/**
 * Peek at the client_id without materialising the full payload. The broker uses
 * this on every forwarded frame; it decodes only the envelope portion.
 */
export function peekClientId(frame: Buffer): string {
  if (frame.length < 3 || frame[0] !== VERSION) throw new Error('bad frame');
  const envLen = frame.readUInt16LE(1);
  const env = dec.decode(frame.subarray(3, 3 + envLen)) as Envelope;
  if (typeof env.client_id !== 'string') throw new Error('missing client_id');
  return env.client_id;
}
