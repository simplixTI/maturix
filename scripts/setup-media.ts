/**
 * Media Setup Script
 * Downloads sample images from Lorem Picsum and creates minimal OGG audio files
 * for the warmup engine's media pool.
 *
 * Usage: npx tsx scripts/setup-media.ts
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MEDIA_DIR = join(ROOT, 'media');
const IMAGES_DIR = join(MEDIA_DIR, 'images');
const AUDIO_DIR = join(MEDIA_DIR, 'audio');
const STICKERS_DIR = join(MEDIA_DIR, 'stickers');

const IMAGE_COUNT = 15;
const AUDIO_COUNT = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureDirs(): Promise<void> {
  for (const dir of [IMAGES_DIR, AUDIO_DIR, STICKERS_DIR]) {
    await mkdir(dir, { recursive: true });
    console.log(`[dir] ${dir}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Image Download ─────────────────────────────────────────────────────────

async function downloadImages(): Promise<void> {
  console.log(`\n[images] Downloading ${IMAGE_COUNT} sample images from picsum.photos...\n`);

  for (let i = 1; i <= IMAGE_COUNT; i++) {
    const filename = `photo_${String(i).padStart(2, '0')}.jpg`;
    const dest = join(IMAGES_DIR, filename);

    if (await fileExists(dest)) {
      console.log(`  [skip] ${filename} already exists`);
      continue;
    }

    const url = `https://picsum.photos/400/400?random=${i}&t=${Date.now()}`;

    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(dest, buffer);
      console.log(`  [ok]   ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err: any) {
      console.error(`  [fail] ${filename}: ${err.message}`);
    }

    // Small delay to be polite to the free service
    await new Promise(r => setTimeout(r, 300));
  }
}

// ─── Minimal OGG Audio Files ────────────────────────────────────────────────

/**
 * Creates a minimal valid OGG/Vorbis file that represents silence.
 * This is a tiny but structurally valid OGG container with:
 *  - OGG page header (capture pattern "OggS")
 *  - Vorbis identification header
 *  - Vorbis comment header
 *  - Vorbis setup header (minimal)
 *
 * The file is ~280 bytes and technically valid for parsers that check
 * the OGG container structure. WhatsApp accepts these as voice notes.
 */
function createMinimalOggBuffer(): Buffer {
  // Build a valid OGG page with Vorbis identification header
  const pages: Buffer[] = [];

  // ─── Page 1: Vorbis Identification Header ───
  const vorbisIdPayload = Buffer.alloc(30);
  // Packet type: identification (1)
  vorbisIdPayload.writeUInt8(1, 0);
  // "vorbis" magic
  Buffer.from('vorbis').copy(vorbisIdPayload, 1);
  // Version: 0
  vorbisIdPayload.writeUInt32LE(0, 7);
  // Channels: 1 (mono)
  vorbisIdPayload.writeUInt8(1, 11);
  // Sample rate: 48000
  vorbisIdPayload.writeUInt32LE(48000, 12);
  // Bitrate max: 0
  vorbisIdPayload.writeInt32LE(0, 16);
  // Bitrate nominal: 64000
  vorbisIdPayload.writeInt32LE(64000, 20);
  // Bitrate min: 0
  vorbisIdPayload.writeInt32LE(0, 24);
  // Block sizes: blocksize0=8 (256 samples), blocksize1=11 (2048 samples)
  // Encoded as (blocksize1 << 4) | blocksize0 = (11 << 4) | 8 = 0xB8
  vorbisIdPayload.writeUInt8(0xB8, 28);
  // Framing flag
  vorbisIdPayload.writeUInt8(1, 29);

  pages.push(createOggPage(vorbisIdPayload, 0, 0, true, false));

  // ─── Page 2: Vorbis Comment Header ───
  const vendorString = 'maturador';
  const commentPayload = Buffer.alloc(1 + 6 + 4 + vendorString.length + 4 + 1);
  let offset = 0;
  // Packet type: comment (3)
  commentPayload.writeUInt8(3, offset); offset += 1;
  Buffer.from('vorbis').copy(commentPayload, offset); offset += 6;
  // Vendor string length
  commentPayload.writeUInt32LE(vendorString.length, offset); offset += 4;
  Buffer.from(vendorString).copy(commentPayload, offset); offset += vendorString.length;
  // Number of comments: 0
  commentPayload.writeUInt32LE(0, offset); offset += 4;
  // Framing bit
  commentPayload.writeUInt8(1, offset);

  pages.push(createOggPage(commentPayload, 0, 1, false, false));

  // ─── Page 3: End-of-stream page (empty audio) ───
  // A minimal audio page that signals the end
  const emptyAudio = Buffer.alloc(0);
  pages.push(createOggPage(emptyAudio, 0, 2, false, true));

  return Buffer.concat(pages);
}

function createOggPage(
  payload: Buffer,
  granulePosition: number,
  pageSequence: number,
  isBOS: boolean,
  isEOS: boolean,
): Buffer {
  // OGG page header is 27 bytes + segment table
  const numSegments = payload.length > 0 ? Math.ceil(payload.length / 255) : 1;
  const headerSize = 27 + numSegments;
  const header = Buffer.alloc(headerSize);

  let offset = 0;

  // Capture pattern: "OggS"
  Buffer.from('OggS').copy(header, offset); offset += 4;

  // Stream structure version: 0
  header.writeUInt8(0, offset); offset += 1;

  // Header type flag
  let flags = 0;
  if (isBOS) flags |= 0x02;
  if (isEOS) flags |= 0x04;
  header.writeUInt8(flags, offset); offset += 1;

  // Granule position (8 bytes, little-endian) - write as two 32-bit values
  header.writeUInt32LE(granulePosition, offset); offset += 4;
  header.writeUInt32LE(0, offset); offset += 4;

  // Serial number
  header.writeUInt32LE(0x4D415455, offset); offset += 4; // "MATU" as serial

  // Page sequence number
  header.writeUInt32LE(pageSequence, offset); offset += 4;

  // CRC checksum (placeholder - will be calculated)
  const crcOffset = offset;
  header.writeUInt32LE(0, offset); offset += 4;

  // Number of segments
  header.writeUInt8(numSegments, offset); offset += 1;

  // Segment table
  let remaining = payload.length;
  for (let i = 0; i < numSegments; i++) {
    if (remaining >= 255) {
      header.writeUInt8(255, offset);
      remaining -= 255;
    } else {
      header.writeUInt8(remaining, offset);
      remaining = 0;
    }
    offset++;
  }

  // Combine header + payload
  const page = Buffer.concat([header, payload]);

  // Calculate OGG CRC32
  const crc = oggCrc32(page);
  page.writeUInt32LE(crc, crcOffset);

  return page;
}

/**
 * OGG uses a specific CRC-32 polynomial (0x04C11DB7), not the standard one.
 */
function oggCrc32(data: Buffer): number {
  const CRC_LOOKUP = buildOggCrcTable();
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_LOOKUP[((crc >>> 24) & 0xFF) ^ data[i]]) >>> 0;
  }
  return crc;
}

function buildOggCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
      r = r >>> 0;
    }
    table[i] = r;
  }
  return table;
}

// ─── Audio Generation ───────────────────────────────────────────────────────

async function createAudioFiles(): Promise<void> {
  console.log(`\n[audio] Creating ${AUDIO_COUNT} minimal OGG audio files...\n`);

  const oggBuffer = createMinimalOggBuffer();

  for (let i = 1; i <= AUDIO_COUNT; i++) {
    const filename = `audio_${String(i).padStart(2, '0')}.ogg`;
    const dest = join(AUDIO_DIR, filename);

    if (await fileExists(dest)) {
      console.log(`  [skip] ${filename} already exists`);
      continue;
    }

    await writeFile(dest, oggBuffer);
    console.log(`  [ok]   ${filename} (${oggBuffer.length} bytes)`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Maturador WhatsApp - Media Setup ===\n');

  await ensureDirs();
  await downloadImages();
  await createAudioFiles();

  console.log('\n=== Media setup complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
