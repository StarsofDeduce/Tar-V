'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createIconService } = require('../lib/icon-service');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tar-v-icon-service-'));
  const executable = path.join(root, 'app.exe');
  const iconFile = path.join(root, 'app.ico');
  const shortcut = path.join(root, 'app.lnk');
  const movedExecutable = path.join(root, 'moved.exe');
  fs.writeFileSync(executable, 'exe');
  fs.writeFileSync(iconFile, 'ico');
  fs.writeFileSync(shortcut, 'lnk');

  let extractCalls = 0;
  let shellCalls = 0;
  const fallbackIcons = {
    file: 'data:image/svg+xml;base64,file',
    folder: 'data:image/svg+xml;base64,folder',
    web: 'data:image/svg+xml;base64,web',
    steam: 'data:image/svg+xml;base64,steam'
  };
  const service = createIconService({
    app: {
      getFileIcon: async () => {
        shellCalls++;
        return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,shell' };
      }
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,direct' })
    },
    extractExecutableIcon: async (filePath, index) => {
      extractCalls++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return Buffer.from(`${filePath}:${index}`).toString('base64');
    },
    cacheDir: path.join(root, 'cache'),
    fallbackIcons
  });

  const [first, second] = await Promise.all([
    service.getIcon({ path: executable }),
    service.getIcon({ path: executable })
  ]);
  assert.deepStrictEqual(first, second, '同一个请求应共享结果');
  assert.strictEqual(first.fallback, false);
  assert.strictEqual(first.source, 'target-resource');
  assert.strictEqual(extractCalls, 1, '并发请求应只提取一次');

  const hot = await service.getIcon({ path: executable });
  assert.deepStrictEqual(hot, first);
  assert.strictEqual(extractCalls, 1, '热缓存不应重复提取');

  await service.getIcon({ path: executable }, { forceRefresh: true });
  assert.strictEqual(extractCalls, 2, '强制刷新应重新提取');

  const direct = await service.getIcon({ path: executable, iconPath: iconFile });
  assert.strictEqual(direct.url, 'data:image/png;base64,direct', '显式 ICO 应按图像内容读取');
  assert.strictEqual(direct.source, 'explicit-image');

  const targetBeforeShortcut = await service.getIcon({ path: executable, shortcutPath: shortcut }, { forceRefresh: true });
  assert.strictEqual(targetBeforeShortcut.source, 'target-resource');
  assert.strictEqual(shellCalls, 0, '目标程序资源图标成功时不应读取通用快捷方式图标');

  const missing = await service.getIcon({ path: movedExecutable });
  assert.strictEqual(missing.fallback, true);
  assert.strictEqual(missing.errorCode, 'TARGET_MISSING');
  assert.strictEqual(missing.url, fallbackIcons.file);
  fs.writeFileSync(movedExecutable, 'exe');
  const retried = await service.getIcon({ path: movedExecutable }, { forceRefresh: true });
  assert.strictEqual(retried.fallback, false, '修复路径后强制刷新必须绕过短期负缓存');

  const steam = await service.getIcon({ path: 'steam://rungameid/123' });
  assert.strictEqual(steam.fallback, true);
  assert.strictEqual(steam.url, fallbackIcons.steam);
  assert.ok(service.stats().entries >= 2);

  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('通过 14 项，失败 0 项');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
