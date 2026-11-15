// PC 앱의 버전이 웹앱(../package.json)과 같은지 확인한다. 다르면 실패한다.
// 설치 파일 이름과 정보 화면에 보이는 버전이 서로 어긋나지 않게 하기 위한 것.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).version;

const desktop = read(path.join(desktopDir, 'package.json'));
const web = read(path.join(desktopDir, '..', 'package.json'));

if (desktop !== web) {
  console.error(`버전이 서로 달라요: desktop/package.json ${desktop} ≠ package.json ${web}`);
  console.error('두 파일의 "version" 을 같은 값으로 맞춰 주세요.');
  process.exit(1);
}
console.log(`버전 일치: ${desktop}`);
