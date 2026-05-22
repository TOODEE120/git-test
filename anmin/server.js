const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || null;
const STORAGE_DIR = path.join(__dirname, 'snapshots');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/snapshots', express.static(STORAGE_DIR));
app.use(express.static(path.join(__dirname)));

let EventModel = null;
let eventBuffer = [];

if (MONGO_URI) {
  mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }).then(() => {
    console.log('Connected to MongoDB');
  }).catch((err) => {
    console.error('MongoDB connection error:', err.message);
  });

  const eventSchema = new mongoose.Schema({
    studentId: String,
    name: String,
    eventType: String,
    message: String,
    riskScore: Number,
    confidence: Number,
    snapshotUrl: String,
    timestamp: String,
    createdAt: { type: Date, default: Date.now }
  });

  EventModel = mongoose.model('Event', eventSchema);
}

function broadcastEvent(payload) {
  io.emit('riskUpdate', payload);
  io.emit('incident', payload);
}

async function persistEvent(payload) {
  if (EventModel) {
    try {
      await new EventModel(payload).save();
    } catch (error) {
      console.error('Error saving event to MongoDB:', error.message);
    }
  } else {
    eventBuffer.push(payload);
    if (eventBuffer.length > 1000) eventBuffer.shift();
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/events', async (req, res) => {
  if (EventModel) {
    const events = await EventModel.find().sort({ createdAt: -1 }).limit(200).lean();
    return res.json(events);
  }
  res.json(eventBuffer.slice(-200));
});

app.post('/api/event', async (req, res) => {
  const payload = req.body;
  if (!payload || !payload.studentId) {
    return res.status(400).json({ error: 'Missing studentId or invalid payload' });
  }

  await persistEvent(payload);
  broadcastEvent(payload);
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('ai:update', async (payload) => {
    if (!payload || !payload.studentId) return;
    await persistEvent(payload);
    broadcastEvent(payload);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'ca.html'));
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
