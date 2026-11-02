import sharp from 'sharp'
import heicConvert from 'heic-convert'
import { stripPdfMetadata } from './validatePdf.js'

// Re-encoding drops all metadata (EXIF, GPS, XMP). rotate() first applies
// the EXIF orientation to the pixels, so a phone photo taken sideways stays
// upright once the orientation tag is gone.
export async function stripMetadata(file) {
    switch (file.mimetype) {
        case 'image/jpeg': {
            file.buffer = await sharp(file.buffer).rotate().jpeg({ quality: 95 }).toBuffer()
            break
        }
        case 'image/png': {
            file.buffer = await sharp(file.buffer).rotate().jpeg({ quality: 95 }).toBuffer()
            file.mimetype = 'image/jpeg'
            break
        }
        case 'image/webp': {
            file.buffer = await sharp(file.buffer).rotate().webp({ quality: 95 }).toBuffer()
            break
        }
        case 'image/heic':
        case 'image/heif': {
            const jpegArrayBuffer = await heicConvert({ buffer: file.buffer, format: 'JPEG', quality: 0.95 })
            file.buffer = await sharp(Buffer.from(jpegArrayBuffer)).jpeg({ quality: 95 }).toBuffer()
            file.mimetype = 'image/jpeg'
            break
        }
        case 'application/pdf': {
            return stripPdfMetadata(file)
        }
    }
    file.size = file.buffer.length
    return null
}
