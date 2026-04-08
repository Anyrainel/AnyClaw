import { describe, it, expect } from 'vitest';
import { encodeFrame, decodeFrame, peekClientId, type Envelope } from '../../src/relay/envelope.js';

const types = ['data','stream_open','stream_close','stream_error'] as const;
const services = ['pb','api','app'] as const;

describe('envelope', () => {
  it('round-trips every type × service', () => {
    for (const type of types) for (const service of services) {
      const env: Envelope = { type, client_id: 'c_abc', service, stream_id: 42, flags: 1 };
      const payload = Buffer.from('hello world');
      const frame = encodeFrame(env, payload);
      expect(frame[0]).toBe(0x01);
      const decoded = decodeFrame(frame);
      expect(decoded.env).toEqual(env);
      expect(Buffer.from(decoded.payload).toString()).toBe('hello world');
    }
  });

  it('peekClientId extracts without parsing payload', () => {
    const env: Envelope = { type: 'data', client_id: 'c_xyz', service: 'pb', stream_id: 0, flags: 0 };
    const frame = encodeFrame(env, Buffer.alloc(1024, 7));
    expect(peekClientId(frame)).toBe('c_xyz');
  });

  it('rejects version != 0x01', () => {
    const bad = Buffer.from([0x02, 0, 0]);
    expect(() => decodeFrame(bad)).toThrow(/version/);
  });

  it('rejects truncated frames', () => {
    expect(() => decodeFrame(Buffer.from([0x01, 0xff, 0xff]))).toThrow();
  });
});
