import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // อนุญาตให้เครื่องอื่นในเครือข่ายเดียวกัน (วง LAN/Wi-Fi) เข้าถึงหน้าเว็บนี้ได้
    allowedHosts: true, // อนุญาตให้เชื่อมต่อผ่านโดเมนภายนอก (เช่น Cloudflare Tunnel หรือ Localtunnel) ได้โดยไม่ถูกบล็อก
  }
});
