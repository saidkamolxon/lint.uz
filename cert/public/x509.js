/* ==========================================================================
   Certificates, read. A small DER reader and what is built on it: X.509
   certificates, certificate requests (PKCS#10), PKCS#7 bundles and keys,
   from PEM text or DER bytes. No library: the formats are old, fixed and
   small enough to read directly, and the page stays light. Signatures are
   checked by the browser's own WebCrypto (see verify below).
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- DER ----------
     A value is a tag, a length and its content. Each node keeps where it
     sits in the bytes, so a part (the signed part of a certificate, a
     public key) can be handed on exactly as it was written. */
  function readNode(bytes, at) {
    const start = at;
    if (at + 2 > bytes.length) throw new Error('The data ends in the middle of a value');
    const tag = bytes[at++];
    if ((tag & 0x1f) === 0x1f) throw new Error('A tag this reader does not know');
    let len = bytes[at++];
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n === 0 || n > 4) throw new Error('A length this reader does not accept');
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + bytes[at++];
    }
    if (at + len > bytes.length) throw new Error('A value runs past the end of the data');
    const node = {
      tag, cls: tag >> 6, constructed: !!(tag & 0x20), num: tag & 0x1f,
      start, head: at - start, len, end: at + len, bytes
    };
    if (node.constructed) {
      node.kids = [];
      let p = at;
      while (p < node.end) {
        const kid = readNode(bytes, p);
        node.kids.push(kid);
        p = kid.end;
      }
    }
    return node;
  }

  function parseDer(bytes) {
    const n = readNode(bytes, 0);
    return n;
  }

  const content = (n) => n.bytes.subarray(n.start + n.head, n.end);
  const whole = (n) => n.bytes.subarray(n.start, n.end);
  const isCtx = (n, num) => n && n.cls === 2 && n.num === num;

  function hex(bytes, sep) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep == null ? '' : sep).toUpperCase();
  }

  function oid(n) {
    const b = content(n);
    const out = [];
    let v = 0;
    for (let i = 0; i < b.length; i++) {
      v = v * 128 + (b[i] & 0x7f);
      if (!(b[i] & 0x80)) {
        if (!out.length) { const first = v < 80 ? Math.floor(v / 40) : 2; out.push(first, v - first * 40); }
        else out.push(v);
        v = 0;
      }
    }
    return out.join('.');
  }

  /* an INTEGER as hex, its sign byte gone; small ones as a number */
  function intHex(n) {
    let b = content(n);
    while (b.length > 1 && b[0] === 0) b = b.subarray(1);
    return hex(b);
  }
  function intNum(n) {
    const b = content(n);
    let v = 0;
    for (let i = 0; i < b.length; i++) v = v * 256 + b[i];
    return v;
  }
  function bitLength(n) {
    let b = content(n);
    while (b.length > 1 && b[0] === 0) b = b.subarray(1);
    let bits = (b.length - 1) * 8;
    for (let x = b[0]; x; x >>= 1) bits++;
    return bits;
  }
  /* a BIT STRING's bytes, past its count of unused bits */
  const bits = (n) => content(n).subarray(1);

  function str(n) {
    const b = content(n);
    if (n.tag === 0x1e) {            // BMPString: UTF-16BE
      let s = '';
      for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
      return s;
    }
    if (n.tag === 0x1c) {            // UniversalString: UTF-32BE
      let s = '';
      for (let i = 0; i + 3 < b.length; i += 4) s += String.fromCodePoint(((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
      return s;
    }
    if (n.tag === 0x0c) return new TextDecoder().decode(b);
    return Array.from(b, (c) => String.fromCharCode(c)).join('');   // Printable, IA5, T61, Visible, Numeric
  }

  function time(n) {
    const s = str(n);
    let m;
    if (n.tag === 0x17) {            // UTCTime: YYMMDDHHMM[SS]Z
      m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s);
      if (!m) return null;
      const y = Number(m[1]);
      return Date.UTC(y < 50 ? 2000 + y : 1900 + y, m[2] - 1, m[3], m[4], m[5], m[6] || 0);
    }
    m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:\.\d+)?Z$/.exec(s);   // GeneralizedTime
    return m ? Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) : null;
  }

  /* ---------- names of things ---------- */
  const ATTR = {
    '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU',
    '2.5.4.5': 'serialNumber', '2.5.4.9': 'street', '2.5.4.17': 'postalCode', '2.5.4.4': 'SN', '2.5.4.42': 'GN',
    '2.5.4.12': 'title', '2.5.4.15': 'businessCategory', '2.5.4.97': 'organizationIdentifier', '2.5.4.46': 'dnQualifier',
    '1.2.840.113549.1.9.1': 'emailAddress', '0.9.2342.19200300.100.1.25': 'DC', '0.9.2342.19200300.100.1.1': 'UID',
    '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC', '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST', '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL'
  };
  const SIG = {
    '1.2.840.113549.1.1.4': { name: 'MD5 with RSA', hash: 'MD5', key: 'RSA' },
    '1.2.840.113549.1.1.5': { name: 'SHA-1 with RSA', hash: 'SHA-1', key: 'RSA' },
    '1.2.840.113549.1.1.14': { name: 'SHA-224 with RSA', hash: 'SHA-224', key: 'RSA' },
    '1.2.840.113549.1.1.11': { name: 'SHA-256 with RSA', hash: 'SHA-256', key: 'RSA' },
    '1.2.840.113549.1.1.12': { name: 'SHA-384 with RSA', hash: 'SHA-384', key: 'RSA' },
    '1.2.840.113549.1.1.13': { name: 'SHA-512 with RSA', hash: 'SHA-512', key: 'RSA' },
    '1.2.840.113549.1.1.10': { name: 'RSA-PSS', hash: null, key: 'RSA-PSS' },
    '1.2.840.10045.4.1': { name: 'ECDSA with SHA-1', hash: 'SHA-1', key: 'EC' },
    '1.2.840.10045.4.3.1': { name: 'ECDSA with SHA-224', hash: 'SHA-224', key: 'EC' },
    '1.2.840.10045.4.3.2': { name: 'ECDSA with SHA-256', hash: 'SHA-256', key: 'EC' },
    '1.2.840.10045.4.3.3': { name: 'ECDSA with SHA-384', hash: 'SHA-384', key: 'EC' },
    '1.2.840.10045.4.3.4': { name: 'ECDSA with SHA-512', hash: 'SHA-512', key: 'EC' },
    '1.3.101.112': { name: 'Ed25519', hash: null, key: 'Ed25519' },
    '1.3.101.113': { name: 'Ed448', hash: null, key: 'Ed448' },
    '1.2.840.10040.4.3': { name: 'DSA with SHA-1', hash: 'SHA-1', key: 'DSA' },
    '2.16.840.1.101.3.4.3.2': { name: 'DSA with SHA-256', hash: 'SHA-256', key: 'DSA' }
  };
  const HASH_OID = {
    '1.3.14.3.2.26': 'SHA-1', '2.16.840.1.101.3.4.2.1': 'SHA-256', '2.16.840.1.101.3.4.2.2': 'SHA-384',
    '2.16.840.1.101.3.4.2.3': 'SHA-512', '2.16.840.1.101.3.4.2.4': 'SHA-224'
  };
  const CURVE = {
    '1.2.840.10045.3.1.7': { name: 'P-256', size: 32 }, '1.3.132.0.34': { name: 'P-384', size: 48 },
    '1.3.132.0.35': { name: 'P-521', size: 66 }, '1.3.132.0.10': { name: 'secp256k1', size: 32 },
    '1.2.840.10045.3.1.1': { name: 'P-192', size: 24 }, '1.3.132.0.33': { name: 'P-224', size: 28 },
    '1.3.36.3.3.2.8.1.1.7': { name: 'brainpoolP256r1', size: 32 }, '1.3.36.3.3.2.8.1.1.11': { name: 'brainpoolP384r1', size: 48 }
  };
  const KEY_ALG = {
    '1.2.840.113549.1.1.1': 'RSA', '1.2.840.113549.1.1.10': 'RSA-PSS', '1.2.840.10045.2.1': 'EC',
    '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448', '1.3.101.110': 'X25519', '1.3.101.111': 'X448',
    '1.2.840.10040.4.1': 'DSA'
  };
  const curveBits = (c) => c.name === 'P-521' ? 521 : c.size * 8;
  const CURVE_OID = {};
  Object.keys(CURVE).forEach((o) => { CURVE_OID[CURVE[o].name] = o; });

  const EKU = {
    '1.3.6.1.5.5.7.3.1': 'Server authentication', '1.3.6.1.5.5.7.3.2': 'Client authentication',
    '1.3.6.1.5.5.7.3.3': 'Code signing', '1.3.6.1.5.5.7.3.4': 'Email protection', '1.3.6.1.5.5.7.3.8': 'Time stamping',
    '1.3.6.1.5.5.7.3.9': 'OCSP signing', '2.5.29.37.0': 'Any purpose', '1.3.6.1.4.1.311.10.3.3': 'Microsoft server gated crypto',
    '2.16.840.1.113730.4.1': 'Netscape server gated crypto', '1.3.6.1.4.1.311.20.2.2': 'Smart card logon',
    '1.3.6.1.5.5.7.3.17': 'IPsec IKE', '1.3.6.1.4.1.311.10.3.12': 'Document signing'
  };
  const KU = ['Digital signature', 'Non-repudiation', 'Key encipherment', 'Data encipherment', 'Key agreement',
              'Certificate signing', 'CRL signing', 'Encipher only', 'Decipher only'];
  const POLICY = {
    '2.23.140.1.2.1': 'Domain validated (DV)', '2.23.140.1.2.2': 'Organization validated (OV)',
    '2.23.140.1.2.3': 'Individual validated (IV)', '2.23.140.1.1': 'Extended validation (EV)',
    '2.5.29.32.0': 'Any policy', '1.3.6.1.4.1.44947.1.1.1': 'ISRG domain validation'
  };
  const EXT = {
    '2.5.29.17': 'Subject alternative names', '2.5.29.19': 'Basic constraints', '2.5.29.15': 'Key usage',
    '2.5.29.37': 'Extended key usage', '2.5.29.14': 'Subject key identifier', '2.5.29.35': 'Authority key identifier',
    '1.3.6.1.5.5.7.1.1': 'Authority information access', '2.5.29.31': 'CRL distribution points',
    '2.5.29.32': 'Certificate policies', '1.3.6.1.4.1.11129.2.4.2': 'Certificate transparency (SCTs)',
    '1.3.6.1.4.1.11129.2.4.3': 'CT precertificate poison', '1.3.6.1.5.5.7.1.24': 'TLS feature (must-staple)',
    '2.5.29.30': 'Name constraints', '2.5.29.36': 'Policy constraints', '2.5.29.54': 'Inhibit any policy',
    '2.5.29.18': 'Issuer alternative names', '2.16.840.1.113730.1.1': 'Netscape certificate type',
    '2.16.840.1.113730.1.13': 'Netscape comment', '1.3.6.1.4.1.311.21.7': 'Microsoft certificate template',
    '1.3.6.1.4.1.311.21.10': 'Microsoft application policies', '1.3.6.1.4.1.311.20.2': 'Microsoft template name',
    '1.3.6.1.5.5.7.1.3': 'Qualified certificate statements', '2.5.29.9': 'Subject directory attributes'
  };

  /* ---------- Names (the Subject and the Issuer) ---------- */
  function name(n) {
    const parts = [];
    (n.kids || []).forEach((rdn) => (rdn.kids || []).forEach((atv) => {
      const [t, v] = atv.kids;
      const id = oid(t);
      parts.push({ type: ATTR[id] || id, oid: id, value: str(v) });
    }));
    const get = (t) => { const p = parts.find((x) => x.type === t); return p ? p.value : ''; };
    return {
      parts,
      der: hex(whole(n)),
      /* the one-line form openssl prints, most specific last */
      text: parts.map((p) => p.type + '=' + p.value).join(', '),
      cn: get('CN'), o: get('O'), ou: get('OU'), c: get('C'),
      /* what to call it: the common name, else the organisation, else anything */
      label: get('CN') || get('O') || get('OU') || (parts[0] ? parts[0].value : '(no name)')
    };
  }

  /* ---------- keys ---------- */
  function spki(n) {
    const [algId, key] = n.kids;
    const algOid = oid(algId.kids[0]);
    const out = { alg: KEY_ALG[algOid] || algOid, der: whole(n), bits: null, curve: null, material: null };
    const keyBytes = bits(key);
    if (out.alg === 'RSA' || out.alg === 'RSA-PSS') {
      try {
        const rsa = parseDer(keyBytes);
        out.bits = bitLength(rsa.kids[0]);
        out.material = intHex(rsa.kids[0]);
        out.e = intHex(rsa.kids[1]);
        out.exponent = intNum(rsa.kids[1]);
      } catch (e) {}
    } else if (out.alg === 'EC') {
      const p = algId.kids[1];
      const c = p && p.tag === 0x06 ? CURVE[oid(p)] : null;
      out.curveOid = p && p.tag === 0x06 ? oid(p) : null;
      out.curve = c ? c.name : out.curveOid || 'explicit parameters';
      out.bits = c ? curveBits(c) : null;
      out.material = hex(keyBytes);
    } else if (out.alg === 'Ed25519' || out.alg === 'X25519') {
      out.bits = 256; out.material = hex(keyBytes);
    } else if (out.alg === 'Ed448' || out.alg === 'X448') {
      out.bits = 448; out.material = hex(keyBytes);
    } else if (out.alg === 'DSA') {
      try { out.bits = bitLength(algId.kids[1].kids[0]); } catch (e) {}
      out.material = hex(keyBytes);
    }
    out.label = keyLabel(out);
    return out;
  }

  function keyLabel(k) {
    if (k.alg === 'RSA' || k.alg === 'RSA-PSS' || k.alg === 'DSA') return k.alg + (k.bits ? ' ' + k.bits : '');
    if (k.alg === 'EC') return 'EC ' + (k.curve || '');
    return k.alg;
  }

  function algorithm(n) {
    const id = oid(n.kids[0]);
    const s = SIG[id];
    const out = { oid: id, name: s ? s.name : id, hash: s ? s.hash : null, key: s ? s.key : null };
    if (id === '1.2.840.113549.1.1.10' && n.kids[1]) {
      /* RSA-PSS keeps its hash and salt in parameters */
      out.saltLength = 20;
      out.hash = 'SHA-1';
      (n.kids[1].kids || []).forEach((p) => {
        if (isCtx(p, 0)) out.hash = HASH_OID[oid(p.kids[0].kids[0])] || out.hash;
        if (isCtx(p, 2)) out.saltLength = intNum(p.kids[0]);
      });
      out.name = 'RSA-PSS with ' + out.hash;
    }
    return out;
  }

  /* ---------- extensions ---------- */
  function generalNames(n) {
    const out = [];
    (n.kids || []).forEach((g) => {
      if (g.cls !== 2) return;
      const b = content(g);
      if (g.num === 2) out.push({ type: 'DNS', value: latin(b) });
      else if (g.num === 7) out.push({ type: 'IP', value: ip(b) });
      else if (g.num === 1) out.push({ type: 'Email', value: latin(b) });
      else if (g.num === 6) out.push({ type: 'URI', value: latin(b) });
      else if (g.num === 4 && g.kids && g.kids[0]) out.push({ type: 'Directory', value: name(g.kids[0]).text });
      else if (g.num === 0) out.push({ type: 'Other', value: g.kids && g.kids[0] ? oid(g.kids[0]) : '' });
    });
    return out;
  }
  const latin = (b) => Array.from(b, (c) => String.fromCharCode(c)).join('');
  function ip(b) {
    if (b.length === 4) return Array.from(b).join('.');
    if (b.length === 16) {
      const w = [];
      for (let i = 0; i < 16; i += 2) w.push(((b[i] << 8) | b[i + 1]).toString(16));
      return w.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
    }
    return hex(b, ':');
  }

  function uris(n, out) {
    out = out || [];
    if (n.cls === 2 && n.num === 6 && !n.constructed) out.push(latin(content(n)));
    (n.kids || []).forEach((k) => uris(k, out));
    return out;
  }

  function extensions(seq) {
    const out = { list: [], san: [], ca: null, pathLen: null, keyUsage: null, extKeyUsage: null, ski: null, aki: null,
                  ocsp: [], caIssuers: [], crl: [], policies: [], scts: null, mustStaple: false };
    (seq.kids || []).forEach((ext) => {
      const id = oid(ext.kids[0]);
      let critical = false, valueNode = ext.kids[1];
      if (valueNode.tag === 0x01) { critical = content(valueNode)[0] !== 0; valueNode = ext.kids[2]; }
      const raw = content(valueNode);
      out.list.push({ oid: id, name: EXT[id] || id, critical });
      let v;
      try { v = parseDer(raw); } catch (e) { return; }
      try {
        if (id === '2.5.29.17') out.san = generalNames(v);
        else if (id === '2.5.29.19') {
          out.ca = false;
          (v.kids || []).forEach((k) => {
            if (k.tag === 0x01) out.ca = content(k)[0] !== 0;
            if (k.tag === 0x02) out.pathLen = intNum(k);
          });
        } else if (id === '2.5.29.15') {
          const b = bits(v);
          out.keyUsage = KU.filter((_, i) => b[i >> 3] & (0x80 >> (i & 7)));
        } else if (id === '2.5.29.37') {
          out.extKeyUsage = (v.kids || []).map((k) => { const o = oid(k); return EKU[o] || o; });
        } else if (id === '2.5.29.14') out.ski = hex(content(v), ':');
        else if (id === '2.5.29.35') {
          const k = (v.kids || []).find((x) => isCtx(x, 0));
          if (k) out.aki = hex(content(k), ':');
        } else if (id === '1.3.6.1.5.5.7.1.1') {
          (v.kids || []).forEach((ad) => {
            const m = oid(ad.kids[0]);
            const u = uris(ad.kids[1]);
            if (m === '1.3.6.1.5.5.7.48.1') out.ocsp.push(...u);
            else if (m === '1.3.6.1.5.5.7.48.2') out.caIssuers.push(...u);
          });
        } else if (id === '2.5.29.31') out.crl = uris(v);
        else if (id === '2.5.29.32') {
          out.policies = (v.kids || []).map((p) => { const o = oid(p.kids[0]); return POLICY[o] || o; });
        } else if (id === '1.3.6.1.4.1.11129.2.4.2') {
          /* a TLS-encoded list inside the octet string: count its entries */
          const b = content(v);
          let p = 2, count = 0;
          while (p + 2 <= b.length) { const l = (b[p] << 8) | b[p + 1]; p += 2 + l; count++; }
          out.scts = count;
        } else if (id === '1.3.6.1.5.5.7.1.24') out.mustStaple = true;
      } catch (e) {}
    });
    return out;
  }

  /* ---------- a certificate ---------- */
  function certificate(der) {
    const root = parseDer(der);
    const [tbs, sigAlg, sigVal] = root.kids;
    if (!tbs || !tbs.kids || !sigVal) throw new Error('Not a certificate');
    let i = 0;
    let version = 1;
    if (isCtx(tbs.kids[0], 0)) { version = intNum(tbs.kids[0].kids[0]) + 1; i++; }
    const serial = tbs.kids[i++];
    i++;                               // the signature algorithm, again
    const issuer = tbs.kids[i++];
    const validity = tbs.kids[i++];
    const subject = tbs.kids[i++];
    const key = tbs.kids[i++];
    let ext = null;
    for (; i < tbs.kids.length; i++) if (isCtx(tbs.kids[i], 3)) ext = tbs.kids[i].kids[0];
    const out = {
      kind: 'certificate',
      der,
      version,
      serial: hex(content(serial).length > 1 && content(serial)[0] === 0 ? content(serial).subarray(1) : content(serial), ':'),
      issuer: name(issuer),
      subject: name(subject),
      notBefore: time(validity.kids[0]),
      notAfter: time(validity.kids[1]),
      key: spki(key),
      sigAlg: algorithm(sigAlg),
      signature: bits(sigVal),
      tbs: whole(tbs),
      ext: ext ? extensions(ext) : extensions({ kids: [] })
    };
    out.selfIssued = out.issuer.der === out.subject.der;
    return out;
  }

  /* ---------- a certificate request ---------- */
  function request(der) {
    const root = parseDer(der);
    const [info, sigAlg, sigVal] = root.kids;
    const [ver, subject, key, attrs] = info.kids;
    let ext = extensions({ kids: [] });
    let challenge = false;
    if (attrs && isCtx(attrs, 0)) {
      (attrs.kids || []).forEach((a) => {
        const id = oid(a.kids[0]);
        if (id === '1.2.840.113549.1.9.14' && a.kids[1].kids[0]) ext = extensions(a.kids[1].kids[0]);
        if (id === '1.2.840.113549.1.9.7') challenge = true;
      });
    }
    return {
      kind: 'request', der, version: intNum(ver) + 1,
      subject: name(subject), key: spki(key), sigAlg: algorithm(sigAlg), signature: bits(sigVal),
      tbs: whole(info), ext, challenge
    };
  }

  /* ---------- PKCS#7: a bag of certificates ---------- */
  function pkcs7(der) {
    const root = parseDer(der);
    if (oid(root.kids[0]) !== '1.2.840.113549.1.7.2') throw new Error('A PKCS#7 file that is not signed data');
    const sd = root.kids[1].kids[0];
    const set = sd.kids.find((k) => isCtx(k, 0));
    return set ? set.kids.map((c) => whole(c)) : [];
  }

  /* ---------- keys: what they are, and the public half to match ---------- */
  function privateKey(der, label) {
    const root = parseDer(der);
    if (label === 'RSA PRIVATE KEY') return rsaPrivate(root, der, 'PKCS#1', der);
    if (label === 'EC PRIVATE KEY') return ecPrivate(root, null, der, 'SEC 1', der);
    /* PKCS#8: version, algorithm, the key in an octet string */
    const algId = root.kids[1];
    const alg = KEY_ALG[oid(algId.kids[0])] || oid(algId.kids[0]);
    const inner = content(root.kids[2]);
    if (alg === 'RSA' || alg === 'RSA-PSS') return rsaPrivate(parseDer(inner), der, 'PKCS#8', inner);
    if (alg === 'EC') {
      const c = algId.kids[1] && algId.kids[1].tag === 0x06 ? CURVE[oid(algId.kids[1])] : null;
      return ecPrivate(parseDer(inner), c, der, 'PKCS#8', inner);
    }
    const out = { kind: 'private-key', der, format: 'PKCS#8', alg, bits: alg === 'Ed448' ? 448 : 256, material: null, pkcs8: true, pkcs8Der: der };
    /* an Ed25519 key's public half comes from WebCrypto, when it can */
    out.label = keyLabel(out);
    return out;
  }
  /* RSA: the numbers that must agree with one another (n = p·q and the
     rest), kept to check the key is whole; they are never shown */
  function rsaPrivate(seq, der, format, traditional) {
    const k = seq.kids;
    const out = {
      kind: 'private-key', der, format, alg: 'RSA', bits: bitLength(k[1]), material: intHex(k[1]), e: intHex(k[2]),
      pkcs8: format === 'PKCS#8',
      parts: { n: intHex(k[1]), e: intHex(k[2]), d: intHex(k[3]), p: intHex(k[4]), q: intHex(k[5]), dp: intHex(k[6]), dq: intHex(k[7]), qi: intHex(k[8]) },
      traditional
    };
    out.pkcs8Der = format === 'PKCS#8' ? der : seqOf(intDer('00'), seqOf(oidDer('1.2.840.113549.1.1.1'), NULL), tlv(0x04, traditional));
    out.label = keyLabel(out);
    return out;
  }
  function ecPrivate(seq, curve, der, format, traditional) {
    let c = curve, material = null;
    (seq.kids || []).forEach((k) => {
      if (isCtx(k, 0) && k.kids[0] && k.kids[0].tag === 0x06) c = CURVE[oid(k.kids[0])] || c;
      if (isCtx(k, 1) && k.kids[0]) material = hex(bits(k.kids[0]));
    });
    const curveOid = c ? CURVE_OID[c.name] : null;
    const out = { kind: 'private-key', der, format, alg: 'EC', curve: c ? c.name : null, curveOid, bits: c ? curveBits(c) : null, material,
                  pkcs8: format === 'PKCS#8', traditional };
    out.pkcs8Der = format === 'PKCS#8' ? der
      : curveOid ? seqOf(intDer('00'), seqOf(oidDer('1.2.840.10045.2.1'), oidDer(curveOid)), tlv(0x04, traditional)) : null;
    out.label = keyLabel(out);
    return out;
  }

  /* ---------- writing DER: enough for keys in their other forms ---------- */
  function concat() {
    const parts = Array.from(arguments);
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }
  function tlv(tag, body) {
    const n = body.length;
    const len = [];
    if (n < 128) len.push(n);
    else { let x = n; while (x) { len.unshift(x & 255); x = Math.floor(x / 256); } len.unshift(0x80 | len.length); }
    return concat(Uint8Array.of(tag, ...len), body);
  }
  function seqOf() { return tlv(0x30, concat.apply(null, arguments)); }
  function fromHex(h) {
    h = h.length % 2 ? '0' + h : h;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  /* an unsigned number as INTEGER, with the zero byte that keeps it positive */
  function unsigned(h) {
    let b = fromHex(h);
    if (b[0] & 0x80) b = concat(Uint8Array.of(0), b);
    return b;
  }
  function intDer(h) { return tlv(0x02, unsigned(h)); }
  function oidDer(s) {
    const p = s.split('.').map(Number);
    const out = [40 * p[0] + p[1]];
    p.slice(2).forEach((v) => {
      const st = [];
      do { st.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v);
      for (let i = 0; i < st.length - 1; i++) st[i] |= 0x80;
      out.push(...st);
    });
    return tlv(0x06, Uint8Array.from(out));
  }
  const NULL = Uint8Array.of(0x05, 0x00);
  const bitStr = (b) => tlv(0x03, concat(Uint8Array.of(0), b));

  /* the public key as SubjectPublicKeyInfo: what a certificate carries */
  function spkiOf(k) {
    if (!k.material) return null;
    if (k.alg === 'RSA' || k.alg === 'RSA-PSS') return seqOf(seqOf(oidDer('1.2.840.113549.1.1.1'), NULL), bitStr(seqOf(intDer(k.material), intDer(k.e || '010001'))));
    if (k.alg === 'EC' && (k.curveOid || CURVE_OID[k.curve])) return seqOf(seqOf(oidDer('1.2.840.10045.2.1'), oidDer(k.curveOid || CURVE_OID[k.curve])), bitStr(fromHex(k.material)));
    if (k.alg === 'Ed25519') return seqOf(seqOf(oidDer('1.3.101.112')), bitStr(fromHex(k.material)));
    return null;
  }

  /* the public key as an OpenSSH authorized_keys line, and its blob */
  const SSH_CURVE = { 'P-256': 'nistp256', 'P-384': 'nistp384', 'P-521': 'nistp521' };
  function sshOf(k) {
    if (!k.material) return null;
    const str = (b) => { const n = b.length; return concat(Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255), b); };
    const txt = (s) => str(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    let type, blob;
    if (k.alg === 'RSA' || k.alg === 'RSA-PSS') { type = 'ssh-rsa'; blob = concat(txt(type), str(unsigned(k.e || '010001')), str(unsigned(k.material))); }
    else if (k.alg === 'EC' && SSH_CURVE[k.curve]) { type = 'ecdsa-sha2-' + SSH_CURVE[k.curve]; blob = concat(txt(type), txt(SSH_CURVE[k.curve]), str(fromHex(k.material))); }
    else if (k.alg === 'Ed25519') { type = 'ssh-ed25519'; blob = concat(txt(type), str(fromHex(k.material))); }
    else return null;
    return { line: type + ' ' + toBase64(blob), blob };
  }

  function jwkOf(k) {
    const url = (b) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!k.material) return null;
    if (k.alg === 'RSA' || k.alg === 'RSA-PSS') return { kty: 'RSA', n: url(fromHex(k.material)), e: url(fromHex(k.e || '010001')) };
    if (k.alg === 'EC' && SSH_CURVE[k.curve]) {
      const b = fromHex(k.material), half = (b.length - 1) / 2;
      return { kty: 'EC', crv: k.curve, x: url(b.subarray(1, 1 + half)), y: url(b.subarray(1 + half)) };
    }
    if (k.alg === 'Ed25519') return { kty: 'OKP', crv: 'Ed25519', x: url(fromHex(k.material)) };
    return null;
  }
  function publicKey(der, label) {
    const root = parseDer(der);
    if (label === 'RSA PUBLIC KEY') {
      const out = { kind: 'public-key', der, alg: 'RSA', bits: bitLength(root.kids[0]), material: intHex(root.kids[0]), e: intHex(root.kids[1]) };
      out.label = keyLabel(out);
      return out;
    }
    const k = spki(root);
    return { kind: 'public-key', ...k, der };
  }

  /* ---------- PEM ----------
     Every -----BEGIN X----- … -----END X----- block, with the line it starts
     on. Text around the blocks (openssl's "subject=" lines, a comment) is
     allowed and left alone. */
  const PEM_RE = /-----BEGIN ([A-Z0-9 #]+)-----([\s\S]*?)-----END \1-----/g;

  function fromBase64(s) {
    const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function toPem(bytes, label) {
    const b = toBase64(bytes);
    return '-----BEGIN ' + label + '-----\n' + b.replace(/.{1,64}/g, '$&\n') + '-----END ' + label + '-----\n';
  }

  function lineAt(text, index) {
    let n = 1;
    for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  /* Everything in a text: each block read, or the reason it could not be */
  function read(text) {
    const items = [];
    let m;
    PEM_RE.lastIndex = 0;
    while ((m = PEM_RE.exec(text))) {
      const label = m[1];
      /* pem: the block's own word for itself; label, once read, says what it is */
      const item = { pem: label, start: m.index, end: m.index + m[0].length, line: lineAt(text, m.index), endLine: lineAt(text, m.index + m[0].length) };
      /* a key encrypted the old OpenSSL way says so in headers before its base64 */
      const body = m[2];
      if (/Proc-Type:\s*4,ENCRYPTED/.test(body)) { item.kind = 'encrypted-key'; items.push(item); continue; }
      try {
        const der = fromBase64(body.replace(/^[A-Za-z-]+:.*$/gm, ''));
        item.der = der;
        Object.assign(item, decode(der, label));
      } catch (e) {
        item.kind = 'error';
        /* the reader's own messages say what is wrong; anything else means
           the bytes are not the structure the label promises */
        const msg = String(e && e.message || e);
        item.error = /^(The data|A value|A tag|A length|Not a|A PKCS)/.test(msg) ? msg.replace(/^A PKCS/, 'a PKCS').replace(/^(\w)/, (c) => c.toLowerCase())
          : /atob|base64|character/i.test(msg) ? 'its base64 is damaged'
          : 'it is not a well-formed ' + label.toLowerCase() + ' (the text may be cut short)';
      }
      items.push(item);
    }
    return items;
  }

  function decode(der, label) {
    if (label === 'CERTIFICATE' || label === 'X509 CERTIFICATE' || label === 'TRUSTED CERTIFICATE') {
      /* a PKCS#7 bundle is sometimes labelled as a certificate */
      try { return certificate(der); } catch (e) {
        try { return { kind: 'bundle', certs: pkcs7(der).map(certificate) }; } catch (e2) { throw e; }
      }
    }
    if (label === 'CERTIFICATE REQUEST' || label === 'NEW CERTIFICATE REQUEST') return request(der);
    if (label === 'PKCS7' || label === 'CMS') return { kind: 'bundle', certs: pkcs7(der).map(certificate) };
    if (label === 'PRIVATE KEY' || label === 'RSA PRIVATE KEY' || label === 'EC PRIVATE KEY') return privateKey(der, label);
    if (label === 'ENCRYPTED PRIVATE KEY') return { kind: 'encrypted-key' };
    if (label === 'PUBLIC KEY' || label === 'RSA PUBLIC KEY') return publicKey(der, label);
    if (label === 'OPENSSH PRIVATE KEY') return { kind: 'unsupported', why: 'An OpenSSH key, not an X.509 one' };
    if (label === 'X509 CRL') return { kind: 'unsupported', why: 'A certificate revocation list' };
    if (label === 'EC PARAMETERS' || label === 'DH PARAMETERS') return { kind: 'parameters' };
    return { kind: 'unsupported', why: 'A ' + label.toLowerCase() + ' block' };
  }

  /* DER bytes of unknown kind (a .cer, .der or .p7b file) as PEM text */
  function derToPem(der) {
    try { certificate(der); return toPem(der, 'CERTIFICATE'); } catch (e) {}
    try { const certs = pkcs7(der); if (certs.length) return certs.map((c) => toPem(c, 'CERTIFICATE')).join(''); } catch (e) {}
    try { request(der); return toPem(der, 'CERTIFICATE REQUEST'); } catch (e) {}
    try { privateKey(der, 'PRIVATE KEY'); return toPem(der, 'PRIVATE KEY'); } catch (e) {}
    try { publicKey(der, 'PUBLIC KEY'); return toPem(der, 'PUBLIC KEY'); } catch (e) {}
    throw new Error('This file is neither PEM text nor a DER certificate, request or key');
  }

  global.CertX509 = {
    read, decode, derToPem, toPem, toBase64, fromBase64, hex, parseDer, certificate, request, pkcs7,
    CURVE, content, whole, intHex, spkiOf, sshOf, jwkOf
  };
})(typeof self !== 'undefined' ? self : globalThis);
