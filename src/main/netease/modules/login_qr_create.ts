/** Builds the QR-login URL and (optionally) a data-URL PNG of it. */

import QRCode from 'qrcode';

import type { NeteaseModule } from '../core/types';

const loginQrCreate: NeteaseModule = async (query) => {
  const url = `https://music.163.com/login?codekey=${query.key}`;
  return {
    status: 200,
    body: {
      code: 200,
      data: { qrurl: url, qrimg: query.qrimg ? await QRCode.toDataURL(url) : '' }
    },
    cookie: []
  };
};

export default loginQrCreate;
