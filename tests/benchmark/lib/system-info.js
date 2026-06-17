// Returns the multi-line footer printed at the end of every benchmark:
// node version + platform/arch, CPU model + core count, total RAM.

import { cpus, totalmem } from 'node:os';

export function systemInfoFooter() {
  const cpuInfo = cpus();
  const cpuModel = cpuInfo[0]?.model?.replace(/\s+/g, ' ').trim() ?? 'unknown';
  const ramGiB = (totalmem() / (1024 ** 3)).toFixed(1);
  return [
    `Node ${process.version} on ${process.platform}/${process.arch}`,
    `CPU: ${cpuModel} (${cpuInfo.length} cores)`,
    `RAM: ${ramGiB} GiB`,
  ].join('\n');
}
