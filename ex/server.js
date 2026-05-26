import { WebSocketServer } from 'ws';
import { Queue } from 'bullmq';
import { z } from 'zod';
import Redis from 'ioredis';

// 1. ตั้งค่า Redis และ Message Queue (พักข้อมูลชั่วคราว ไม่ให้ฐานข้อมูลรับโหลดหนักไป)
let redisConnection;
try {
    redisConnection = new Redis({ host: '127.0.0.1', port: 6379, retryStrategy: (times) => Math.min(1000 * Math.pow(2, times), 10000) });
    redisConnection.on('error', (err) => console.error('[Redis Error]', err.message));
} catch (err) {
    console.error('[Critical] Redis connection failed:', err.message);
    process.exit(1);
}

const eventQueue = new Queue('anti-cheat-events', { connection: redisConnection });

// 2. Data Validation Schema ป้องกันคนเขียน Script ยิง API ปลอมเข้ามาป่วน
const EventPayloadSchema = z.object({
    uid: z.string().length(22).regex(/^[a-zA-Z0-9-_]+$/),
    type: z.enum(['GAZE', 'HEAD_POSE', 'TAB_SWITCH', 'LIVENESS', 'SUBMIT', 'SYSTEM']),
    data: z.record(z.any()).refine(obj => Object.keys(obj).length <= 50, { message: 'Too many data fields' }),
    timestamp: z.number().int().positive().refine(t => Math.abs(Date.now() - t) < 60000, { message: 'Timestamp too old' })
});

const wss = new WebSocketServer({ port: 8080 });

// 3. Rate Limiting State เก็บไว้ใน Memory เพื่อความเร็วในการตรวจจับ
const rateLimits = new Map();
const MAX_MESSAGES_PER_SEC = 15; // ห้ามส่งข้อมูลรัวเกิน 15 ครั้งใน 1 วินาที
const MAX_CONNECTIONS = 1000; // จำกัดจำนวน connections
const CLEANUP_INTERVAL = 60000; // ทำความสะอาด rate limits ทุก 1 นาที

// Cleanup old rate limit entries
setInterval(() => {
    const now = Date.now();
    for (const [ip, state] of rateLimits.entries()) {
        if (now - state.lastReset > 300000) { // ลบ entries ที่เก่าเกิน 5 นาที
            rateLimits.delete(ip);
        }
    }
    console.log(`[Cleanup] Active connections: ${wss.clients.size}, Rate limit entries: ${rateLimits.size}`);
}, CLEANUP_INTERVAL);

wss.on('connection', (ws, req) => {
    if (wss.clients.size > MAX_CONNECTIONS) {
        ws.close(1008, 'Server capacity exceeded');
        return;
    }

    const clientIp = req.socket.remoteAddress || 'unknown';
    const limitState = { count: 0, lastReset: Date.now() };
    rateLimits.set(clientIp, limitState);

    ws.on('message', async (rawMessage) => {
        try {
            const now = Date.now();

            // 4. Rate Limiting Logic (ด่านตรวจจับสแปม)
            if (now - limitState.lastReset > 1000) {
                limitState.count = 0;
                limitState.lastReset = now;
            }
            if (limitState.count >= MAX_MESSAGES_PER_SEC) {
                ws.send(JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED', code: 429 }));
                return; // บล็อกทันที ไม่ให้ส่งข้อมูลเข้าระบบ
            }
            limitState.count++;

            // 5. Message Size Check (ป้องกัน Buffer overflow)
            if (rawMessage.length > 1024 * 10) { // 10KB max
                ws.send(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', code: 413 }));
                return;
            }

            // 6. Schema Validation (กรอง Data ให้สะอาดที่สุด)
            let parsedData;
            try {
                parsedData = JSON.parse(rawMessage);
            } catch (parseErr) {
                ws.send(JSON.stringify({ error: 'INVALID_JSON', code: 400 }));
                return;
            }

            const validData = EventPayloadSchema.parse(parsedData);

            // 7. โยนเข้า Message Queue ทันที
            // Worker อีกตัวจะมาหยิบข้อมูลนี้ไปเซฟลง MongoDB ทีหลัง ทำให้ Server ไม่ Block เลยแม้แต่นิดเดียว
            await eventQueue.add('process-event', validData, {
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                timeout: 5000
            });

            ws.send(JSON.stringify({ status: 'ok', code: 200 }));
        } catch (error) {
            if (error instanceof z.ZodError) {
                ws.send(JSON.stringify({ error: 'VALIDATION_FAILED', details: error.errors.slice(0, 3), code: 422 }));
            } else {
                console.error('[Event Processing Error]', error.message);
                ws.send(JSON.stringify({ error: 'INTERNAL_ERROR', code: 500 }));
            }
        }
    });

    ws.on('error', (err) => {
        console.error(`[WebSocket Error from ${clientIp}]`, err.message);
    });

    ws.on('close', () => {
        rateLimits.delete(clientIp);
    });
});

wss.on('error', (err) => {
    console.error('[WebSocket Server Error]', err.message);
});

console.log('🚀 High-Concurrency Proctoring Server is running on ws://localhost:8080');