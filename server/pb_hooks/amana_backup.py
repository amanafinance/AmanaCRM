#!/usr/bin/env python3
"""Шифрование почтовой копии; данные и пароль поступают по stdin, не через аргументы."""
import base64
import hashlib
import json
import os
import sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def encrypt(payload):
    password = payload['password']
    if not isinstance(password, str) or len(password) < 8:
        raise ValueError('Пароль должен содержать не меньше 8 символов')
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 310000, 32)
    body = json.dumps(payload['backup'], ensure_ascii=False, separators=(',', ':')).encode()
    ciphertext = AESGCM(key).encrypt(iv, body, None)
    b64 = lambda value: base64.b64encode(value).decode()
    return {'format': 'amana-crm-backup-encrypted', 'version': 1,
            'kdf': {'name': 'PBKDF2', 'hash': 'SHA-256', 'iterations': 310000, 'salt': b64(salt)},
            'cipher': {'name': 'AES-GCM', 'iv': b64(iv)}, 'data': b64(ciphertext)}

if __name__ == '__main__':
    try:
        print(json.dumps(encrypt(json.load(sys.stdin)), ensure_ascii=False))
    except Exception:
        print('Не удалось зашифровать резервную копию', file=sys.stderr)
        sys.exit(1)
