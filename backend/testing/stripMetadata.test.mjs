import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { stripMetadata } from '../src/middleware/stripMetadata.js'

// A 40x20 photo whose EXIF says "rotate 90°" (Orientation 6) and carries a
// GPS position and camera model, like a phone photo.
async function phonePhoto(format) {
    // sharp sets Orientation itself, so it goes through withMetadata.
    const image = sharp({ create: { width: 40, height: 20, channels: 3, background: '#808080' } })
        .withMetadata({ orientation: 6 })
        .withExifMerge({
            IFD0: { Model: 'Test Phone' },
            IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
        })
    return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer()
}

test('a phone photo loses its EXIF and GPS, and stays upright', async () => {
    const buffer = await phonePhoto('jpeg')
    assert.ok((await sharp(buffer).metadata()).exif, 'fixture has EXIF')

    const file = { buffer, mimetype: 'image/jpeg' }
    await stripMetadata(file)
    const after = await sharp(file.buffer).metadata()

    assert.equal(after.exif, undefined)
    assert.equal(after.orientation, undefined)
    assert.ok(!file.buffer.includes('Test Phone'))
    // Rotated into the pixels: 40x20 sideways becomes 20x40 upright.
    assert.deepEqual([after.width, after.height], [20, 40])
    assert.equal(file.size, file.buffer.length)
})

test('PNG comes out as JPEG without metadata', async () => {
    const file = { buffer: await phonePhoto('png'), mimetype: 'image/png' }
    await stripMetadata(file)
    const after = await sharp(file.buffer).metadata()
    assert.equal(file.mimetype, 'image/jpeg')
    assert.equal(after.format, 'jpeg')
    assert.equal(after.exif, undefined)
})
