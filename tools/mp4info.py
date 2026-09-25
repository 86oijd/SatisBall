# Inspect an MP4: per-track type, size, sample count, duration. Usage: python3 tools/mp4info.py file.mp4
import struct, sys
def boxes(d, o, e):
    while o + 8 <= e:
        size, typ = struct.unpack('>I4s', d[o:o + 8]); hdr = 8
        if size == 1: size = struct.unpack('>Q', d[o + 8:o + 16])[0]; hdr = 16
        if size == 0: size = e - o
        yield typ.decode('latin1'), o + hdr, o + size
        o += size
def find(d, o, e, path):
    for t, s, en in boxes(d, o, e):
        if t == path[0]:
            if len(path) == 1: yield s, en
            else: yield from find(d, s, en, path[1:])
d = open(sys.argv[1], 'rb').read()
for ms, me in find(d, 0, len(d), ['moov']):
    for ts, te in find(d, ms, me, ['trak']):
        kind = next(d[s + 8:s + 12].decode() for s, e in find(d, ts, te, ['mdia', 'hdlr']))
        s, e = next(find(d, ts, te, ['mdia', 'mdhd']))
        v = d[s]; scale, dur = struct.unpack('>II', d[s + 12:s + 20]) if v == 0 else struct.unpack('>IQ', d[s + 20:s + 32])
        s2, e2 = next(find(d, ts, te, ['mdia', 'minf', 'stbl', 'stsz']))
        n = struct.unpack('>I', d[s2 + 8:s2 + 12])[0]
        s3, e3 = next(find(d, ts, te, ['tkhd']))
        w, h = (struct.unpack('>II', d[e3 - 8:e3])[0] >> 16, struct.unpack('>II', d[e3 - 8:e3])[1] >> 16)
        print(f"{kind}: samples={n} duration={dur / scale:.3f}s" + (f" size={w}x{h} fps={n / (dur / scale):.2f}" if kind == 'vide' else ''))
