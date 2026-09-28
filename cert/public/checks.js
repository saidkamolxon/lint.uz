/* ==========================================================================
   What a file of certificates means: which one is the server's, the chain
   it hangs from and whether each link was really signed by the next, when
   each runs out, which key belongs to which certificate, and what is wrong.
   Signatures are checked with WebCrypto, so "signed by" is a fact, not a
   matching of names.
   ========================================================================== */
(function (global) {
  'use strict';

  const X = global.CertX509;
  const DAY = 86400000;
  const subtle = () => (global.crypto && global.crypto.subtle) || null;

  /* ---------- signatures ---------- */
  function derSigToRaw(sig, size) {
    const seq = X.parseDer(sig);
    const part = (n) => {
      let b = X.content(n);
      while (b.length > size && b[0] === 0) b = b.subarray(1);
      const out = new Uint8Array(size);
      out.set(b, size - b.length);
      return out;
    };
    const raw = new Uint8Array(size * 2);
    raw.set(part(seq.kids[0]), 0);
    raw.set(part(seq.kids[1]), size);
    return raw;
  }

  const WEB_CURVES = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

  /* true: signed by that key; false: not; null: this browser cannot tell */
  async function verify(sigAlg, signature, tbs, key) {
    const s = subtle();
    if (!s) return null;
    const family = sigAlg.key;
    if (family === 'RSA' || family === 'RSA-PSS') { if (key.alg !== 'RSA' && key.alg !== 'RSA-PSS') return false; }
    else if (family === 'EC') { if (key.alg !== 'EC') return false; }
    else if (family === 'Ed25519') { if (key.alg !== 'Ed25519') return false; }
    else return null;
    try {
      if (family === 'RSA') {
        if (!/^SHA-(1|256|384|512)$/.test(sigAlg.hash || '')) return null;
        const k = await s.importKey('spki', key.der, { name: 'RSASSA-PKCS1-v1_5', hash: sigAlg.hash }, false, ['verify']);
        return await s.verify('RSASSA-PKCS1-v1_5', k, signature, tbs);
      }
      if (family === 'RSA-PSS') {
        const k = await s.importKey('spki', key.der, { name: 'RSA-PSS', hash: sigAlg.hash }, false, ['verify']);
        return await s.verify({ name: 'RSA-PSS', saltLength: sigAlg.saltLength }, k, signature, tbs);
      }
      if (family === 'EC') {
        const size = WEB_CURVES[key.curve];
        if (!size || !/^SHA-(1|256|384|512)$/.test(sigAlg.hash || '')) return null;
        const k = await s.importKey('spki', key.der, { name: 'ECDSA', namedCurve: key.curve }, false, ['verify']);
        return await s.verify({ name: 'ECDSA', hash: sigAlg.hash }, k, derSigToRaw(signature, size), tbs);
      }
      if (family === 'Ed25519') {
        const k = await s.importKey('spki', key.der, { name: 'Ed25519' }, false, ['verify']);
        return await s.verify('Ed25519', k, signature, tbs);
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  async function digest(alg, bytes) {
    const s = subtle();
    if (!s) return null;
    try { return new Uint8Array(await s.digest(alg, bytes)); } catch (e) { return null; }
  }

  /* the public half of a private key WebCrypto can read but the file does
     not spell out (a PKCS#8 EC key without its point, an Ed25519 key) */
  async function publicOf(key) {
    const s = subtle();
    if (!s || !key.pkcs8) return null;
    try {
      if (key.alg === 'EC' && WEB_CURVES[key.curve]) {
        const k = await s.importKey('pkcs8', key.der, { name: 'ECDSA', namedCurve: key.curve }, true, ['sign']);
        const j = await s.exportKey('jwk', k);
        return '04' + X.hex(b64url(j.x)) + X.hex(b64url(j.y));
      }
      if (key.alg === 'Ed25519') {
        const k = await s.importKey('pkcs8', key.der, { name: 'Ed25519' }, true, ['sign']);
        const j = await s.exportKey('jwk', k);
        return X.hex(b64url(j.x));
      }
    } catch (e) {}
    return null;
  }
  function b64url(s) { return X.fromBase64(s.replace(/-/g, '+').replace(/_/g, '/')); }

  /* ---------- a key's own health ---------- */
  /* RSA's numbers must agree: n = p·q, d undoes e modulo p−1 and q−1, and
     the shortcuts (dp, dq, qi) follow from them. EC: the public point in
     the file must be the one the private number gives. */
  async function intact(k) {
    if (k.kind !== 'private-key') return null;
    if (k.parts && typeof BigInt === 'function') {
      try {
        const b = (h) => BigInt('0x' + h);
        const { n, e, d, p, q, dp, dq, qi } = Object.fromEntries(Object.entries(k.parts).map(([x, h]) => [x, b(h)]));
        const one = BigInt(1);
        return n === p * q && (e * d) % (p - one) === one && (e * d) % (q - one) === one &&
          dp === d % (p - one) && dq === d % (q - one) && (qi * q) % p === one;
      } catch (err) { return null; }
    }
    if (k.alg === 'EC' && k.material && k.pkcs8Der && WEB_CURVES[k.curve]) {
      const given = k.material;
      const derived = await publicOf({ pkcs8: true, alg: 'EC', curve: k.curve, der: k.pkcs8Der });
      return derived ? derived === given : null;
    }
    return null;
  }

  /* how hard the key is to break, in the bits of work it would take */
  function strength(k) {
    const b = k.bits;
    if (k.alg === 'RSA' || k.alg === 'RSA-PSS') {
      if (!b) return null;
      if (b < 2048) return { level: 'break', text: 'Weak: under 2048 bits, which browsers and CAs refuse' };
      if (b < 3072) return { level: '', text: 'About 112-bit security: the usual minimum, fine until about 2030' };
      if (b < 4096) return { level: '', text: 'About 128-bit security: good for years to come' };
      return { level: '', text: 'About 140-bit security or more; slower than EC for the same safety' };
    }
    if (k.alg === 'EC') return b ? { level: '', text: 'About ' + Math.floor(b / 2) + '-bit security' } : null;
    if (k.alg === 'Ed25519') return { level: '', text: 'About 128-bit security' };
    return null;
  }

  /* ---------- names a certificate answers to ---------- */
  function cleanHost(input) {
    let h = String(input || '').trim().toLowerCase();
    if (!h) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) { try { h = new URL(h).hostname; } catch (e) {} }
    h = h.replace(/\/.*$/, '');
    if (/^\[.*\]/.test(h)) h = h.replace(/^\[(.*)\].*$/, '$1');
    else if ((h.match(/:/g) || []).length === 1) h = h.replace(/:\d+$/, '');
    return h.replace(/\.$/, '');
  }

  function isIp(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^[0-9a-f:]+$/.test(h) && h.includes(':'); }

  function wildcard(pattern, host) {
    const p = pattern.toLowerCase().replace(/\.$/, '');
    if (p === host) return true;
    /* a * stands for exactly one whole label, and only the leftmost */
    if (!p.startsWith('*.')) return false;
    const rest = p.slice(2);
    const dot = host.indexOf('.');
    return dot > 0 && host.slice(dot + 1) === rest;
  }

  function covers(cert, input) {
    const host = cleanHost(input);
    if (!host) return null;
    const san = cert.ext.san;
    if (isIp(host)) {
      const hit = san.find((s) => s.type === 'IP' && s.value.toLowerCase() === host);
      return { host, ok: !!hit, by: hit ? hit.value : null };
    }
    const names = san.filter((s) => s.type === 'DNS').map((s) => s.value);
    const hit = names.find((n) => wildcard(n, host));
    if (hit) return { host, ok: true, by: hit };
    /* browsers stopped reading the common name; say so if it would have matched */
    if (!names.length && cert.subject.cn && wildcard(cert.subject.cn, host)) return { host, ok: false, cnOnly: true, by: cert.subject.cn };
    return { host, ok: false, by: null };
  }

  /* ---------- the analysis ---------- */
  function days(ms) { return Math.round(ms / DAY); }
  function fmtDate(t) {
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  /* a span of days as people say it: days, then months, then years */
  function span(d) {
    if (d < 60) return plural(d, 'day');
    if (d < 730) return plural(Math.round(d / 30.44), 'month');
    const y = d / 365.25;
    return (y < 10 ? (Math.round(y * 10) / 10) : Math.round(y)) + ' years';
  }

  async function analyze(text, now) {
    now = now || Date.now();
    const items = X.read(text);
    const certs = [];
    const keys = [];
    const requests = [];
    const others = [];
    items.forEach((it) => {
      if (it.kind === 'certificate') certs.push({ c: it, line: it.line, endLine: it.endLine, item: it });
      else if (it.kind === 'bundle') it.certs.forEach((c) => certs.push({ c, line: it.line, endLine: it.endLine, item: it, inBundle: true }));
      else if (it.kind === 'private-key' || it.kind === 'public-key' || it.kind === 'encrypted-key') keys.push(it);
      else if (it.kind === 'request') requests.push(it);
      else others.push(it);
    });
    certs.forEach((x, i) => { x.n = i + 1; x.name = x.c.subject.label; });

    /* fingerprints: what people compare a certificate by */
    await Promise.all(certs.map(async (x) => {
      const [s256, s1, pin] = await Promise.all([digest('SHA-256', x.c.der), digest('SHA-1', x.c.der), digest('SHA-256', x.c.key.der)]);
      x.sha256 = s256 ? X.hex(s256, ':') : null;
      x.sha1 = s1 ? X.hex(s1, ':') : null;
      x.pin = pin ? X.toBase64(pin) : null;
    }));

    /* who signed whom: a candidate issuer carries the subject name the
       certificate names as its issuer (and the key id, where both say one),
       and its key must check the signature */
    const verifyTasks = [];
    certs.forEach((x) => {
      x.issuers = [];
      certs.forEach((y) => {
        if (y.c.subject.der !== x.c.issuer.der) return;
        if (x !== y && x.c.ext.aki && y.c.ext.ski && x.c.ext.aki !== y.c.ext.ski) return;
        const link = { by: y, ok: null };
        x.issuers.push(link);
        verifyTasks.push(verify(x.c.sigAlg, x.c.signature, x.c.tbs, y.c.key).then((ok) => { link.ok = ok; }));
      });
    });
    await Promise.all(verifyTasks);
    certs.forEach((x) => {
      const self = x.issuers.find((l) => l.by === x);
      x.selfSigned = !!self && self.ok !== false;
      x.ca = x.c.ext.ca === true;
      x.signs = certs.filter((y) => y !== x && y.issuers.some((l) => l.by === x && l.ok !== false));
    });

    /* the server's certificate: one nothing else here hangs from, not a CA
       if there is a choice; then up through the issuers */
    const tops = certs.filter((x) => !x.signs.length);
    const leaf = tops.find((x) => !x.ca) || tops[0] || certs[0] || null;
    const path = [];
    const links = [];         // [{from, to, ok}] along the path
    if (leaf) {
      let cur = leaf;
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        path.push(cur);
        const up = cur.issuers.filter((l) => l.by !== cur);
        const best = up.find((l) => l.ok === true) || up.find((l) => l.ok === null) || up[0];
        if (!best || seen.has(best.by)) break;
        links.push({ from: cur, to: best.by, ok: best.ok });
        cur = best.by;
      }
    }
    const top = path[path.length - 1] || null;
    const extras = certs.filter((x) => !path.includes(x));

    /* keys: whether each is whole, its public half in the forms people
       compare (pin, SSH fingerprint), and which certificate it belongs to */
    await Promise.all(keys.map(async (k) => {
      if (k.kind === 'encrypted-key') return;
      if (!k.material) k.material = await publicOf(k);
      k.intact = await intact(k);
      k.strength = strength(k);
      k.spki = X.spkiOf(k);
      if (k.spki) { const pin = await digest('SHA-256', k.spki); k.pin = pin ? X.toBase64(pin) : null; }
      const ssh = X.sshOf(k);
      if (ssh) {
        k.ssh = ssh.line;
        const fp = await digest('SHA-256', ssh.blob);
        k.sshFp = fp ? 'SHA256:' + X.toBase64(fp).replace(/=+$/, '') : null;
      }
      k.jwk = X.jwkOf(k);
      k.matches = k.material ? certs.filter((x) => x.c.key.material === k.material) : [];
      k.matchesRequest = k.material ? requests.filter((r) => r.key.material === k.material) : [];
    }));
    await Promise.all(requests.map(async (r) => { r.sigOk = await verify(r.sigAlg, r.signature, r.tbs, r.key); }));

    /* ---------- problems ---------- */
    const problems = [];
    const add = (impact, short, message, where, extra) => problems.push(Object.assign({ impact, short, message, line: where ? where.line : null, n: where && where.n }, extra || {}));

    others.forEach((o) => {
      if (o.kind === 'error') add('break', 'Unreadable', 'The ' + o.pem.toLowerCase() + ' block on line ' + o.line + ' could not be read: ' + o.error + '.', o);
      else if (o.kind === 'unsupported') add('fyi', 'Not read', o.why + ' on line ' + o.line + '; it is left as it is.', o);
    });

    const serverCert = leaf && !leaf.ca;
    path.forEach((x, i) => {
      const c = x.c;
      const who = path.length > 1 ? (i === 0 ? 'The certificate' : x.selfSigned ? 'The root' : 'The intermediate') + ' (' + x.name + ')' : 'The certificate';
      if (c.notAfter != null && c.notAfter < now) add('break', 'Expired', who + ' expired ' + plural(days(now - c.notAfter), 'day') + ' ago, on ' + fmtDate(c.notAfter) + '.', x);
      else if (c.notBefore != null && c.notBefore > now) add('break', 'Not yet valid', who + ' is not valid until ' + fmtDate(c.notBefore) + '.', x);
      else if (c.notAfter != null && c.notAfter - now < 30 * DAY) add('risk', 'Expires soon', who + ' expires in ' + plural(Math.max(0, days(c.notAfter - now)), 'day') + ', on ' + fmtDate(c.notAfter) + '.', x);
      if (!x.selfSigned && /^(MD5|SHA-1)$/.test(c.sigAlg.hash || '')) add('break', 'Weak signature', who + ' is signed with ' + c.sigAlg.hash + ', which browsers no longer accept.', x);
      if ((c.key.alg === 'RSA' || c.key.alg === 'RSA-PSS') && c.key.bits && c.key.bits < 2048) add('break', 'Weak key', who + ' has a ' + c.key.bits + '-bit RSA key; browsers require 2048 bits or more.', x);
    });
    links.forEach((l) => {
      if (l.ok === false) add('break', 'Not signed', '#' + l.to.n + ' (' + l.to.name + ') has the right name to be the issuer of #' + l.from.n + ', but its key did not sign it.', l.from);
    });

    if (leaf && serverCert) {
      const c = leaf.c;
      if (path.length === 1 && leaf.selfSigned) add('risk', 'Self-signed', 'The certificate is self-signed: browsers show a warning unless the machine was told to trust it.', leaf);
      else if (!top.selfSigned && path.length === 1) add('risk', 'No intermediate', 'Only the certificate itself, without the intermediate that signed it (' + c.issuer.label + '). If this is what the server sends, many clients (curl, Java, Android, Python) fail to connect: use the full chain.', leaf, { fix: 'none' });
      if (!c.ext.san.length) add('risk', 'No SAN', 'No subject alternative names. Browsers ignore the common name and match only these, so this certificate matches no domain.', leaf);
      const life = c.notAfter - c.notBefore;
      if (!leaf.selfSigned && c.notBefore >= Date.UTC(2020, 8, 1) && life > 398 * DAY + DAY &&
          (!c.ext.extKeyUsage || c.ext.extKeyUsage.includes('Server authentication'))) {
        add('risk', 'Too long', 'It is valid for ' + span(days(life)) + '. Browsers reject public web certificates valid for more than 398; a private CA can issue longer ones.', leaf);
      }
      if (c.ext.extKeyUsage && !c.ext.extKeyUsage.some((u) => /Server authentication|Any purpose/.test(u))) {
        add('fyi', 'Not for servers', 'Its extended key usage (' + c.ext.extKeyUsage.join(', ') + ') does not include server authentication.', leaf);
      }
    }

    /* order: what servers send is the certificate first, then each issuer */
    const pathInFile = path.filter((x) => !x.inBundle);
    const order = pathInFile.map((x) => x.n);
    const outOfOrder = order.some((n, i) => i && n < order[i - 1]);
    if (outOfOrder) add('risk', 'Out of order', 'The chain is out of order. Servers send the certificate first, then each issuer; nginx, HAProxy and others read it in that order.', path[0], { fix: 'order' });
    if (top && top.selfSigned && path.length > 1) add('fyi', 'Root included', 'The root (' + top.name + ') is included. Clients already have their roots, so servers need not send it.', top);
    extras.forEach((x) => add('fyi', 'Not in the chain', '#' + x.n + ' (' + x.name + ') is not part of the chain from ' + (leaf ? leaf.name : 'the certificate') + '.', x));

    keys.forEach((k) => {
      if (k.kind === 'encrypted-key') { add('fyi', 'Encrypted key', 'An encrypted private key on line ' + k.line + ': it needs its password, so it was not read.', k); return; }
      if (k.intact === false) add('break', 'Damaged key', 'The private key on line ' + k.line + ' is damaged: its parts do not agree with one another. It was probably cut short or edited.', k);
      if (k.kind === 'private-key') add('risk', 'Private key', 'This file holds a private key (line ' + k.line + '). Anyone who has it can pose as the server: keep it off chat, tickets and email.', k);
      if (certs.length && k.material && !k.matches.length && !k.matchesRequest.length) add('break', 'Key mismatch', 'The ' + (k.kind === 'private-key' ? 'private' : 'public') + ' key on line ' + k.line + ' belongs to none of the certificates here. A server given this pair will not start.', k);
      /* a server checks its key against the first certificate it sends */
      else if (k.kind === 'private-key' && leaf && serverCert && k.matches.length && !k.matches.includes(leaf)) {
        add('break', 'Wrong key', 'The private key on line ' + k.line + ' belongs to #' + k.matches[0].n + ' (' + k.matches[0].name + '), not to the server\'s certificate (' + leaf.name + '). A server given this pair will not start.', k);
      }
    });
    requests.forEach((r) => {
      if (r.sigOk === false) add('break', 'Bad request', 'The certificate request on line ' + r.line + ' is not signed by its own key: a CA will refuse it.', r);
      if ((r.key.alg === 'RSA') && r.key.bits < 2048) add('break', 'Weak key', 'The request asks for a ' + r.key.bits + '-bit RSA key; CAs require 2048 bits or more.', r);
    });

    const IMPACT = { break: 0, risk: 1, fyi: 2 };
    problems.sort((a, b) => IMPACT[a.impact] - IMPACT[b.impact]);

    /* ---------- the answer, in one sentence ---------- */
    const breaks = problems.filter((p) => p.impact === 'break');
    let verdict, level = 'ok';
    if (breaks.length) { verdict = breaks[0].message; level = 'break'; }
    else if (leaf) {
      const left = days(leaf.c.notAfter - now);
      verdict = 'Valid until ' + fmtDate(leaf.c.notAfter) + ', ' + span(left) + ' from now.';
      if (path.length > 1) verdict += links.every((l) => l.ok === true) ? ' Every link in the chain is signed by the next.' : ' The chain is complete.';
      if (problems.some((p) => p.impact === 'risk')) level = 'risk';
    } else if (requests.length) {
      verdict = 'A certificate request for ' + (requests[0].subject.cn || requests[0].subject.label) + '.';
    } else if (keys.length) {
      const k = keys[0];
      verdict = k.kind === 'encrypted-key' ? 'An encrypted private key.'
        /* RSA, EC and Ed25519 are all said with a vowel: "an" */
        : 'A' + (/^([AEIOU]|RSA|EC|Ed)/.test(k.label) ? 'n ' : ' ') + k.label + (k.kind === 'private-key' ? ' private key' : ' public key') +
          (k.intact === true ? ', whole: its parts agree.' : '.') + (keys.length === 1 && !certs.length ? ' Paste its certificate after it to check they belong together.' : '');
      if (problems.some((p) => p.impact === 'risk')) level = 'risk';
    } else {
      verdict = null;
    }

    return { certs, keys, requests, others, leaf, path, links, top, extras, problems, verdict, level, outOfOrder, now };
  }

  /* the same file with the chain in the order servers send it: the blocks
     moved, everything else left where it was */
  function reorder(text, a) {
    const blocks = a.path.filter((x) => !x.inBundle).map((x) => x.item);
    if (blocks.length < 2) return text;
    const slots = blocks.slice().sort((p, q) => p.start - q.start);
    let out = '', at = 0;
    slots.forEach((slot, i) => {
      out += text.slice(at, slot.start) + text.slice(blocks[i].start, blocks[i].end);
      at = slot.end;
    });
    return out + text.slice(at);
  }

  global.CertChecks = { analyze, covers, cleanHost, reorder, verify, span };
})(typeof self !== 'undefined' ? self : globalThis);
