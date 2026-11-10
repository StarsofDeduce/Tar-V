'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createIconService, MAX_ICON_DATA_URL_LENGTH } = require('../lib/icon-service');
const { buildIconExtractScript, buildFolderTypeIconScript, runEncodedPowerShell } = require('../lib/powershell');
const { findSquirrelIconSource } = require('../lib/squirrel-icon');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tar-v-icon-service-'));
  const executable = path.join(root, 'app.exe');
  const iconFile = path.join(root, 'app.ico');
  const shortcut = path.join(root, 'app.lnk');
  const movedExecutable = path.join(root, 'moved.exe');
  const folder = path.join(root, 'folder');
  const portableApp = path.join(root, 'PortableBox');
  const ambiguousFolder = path.join(root, 'Ambiguous');
  const unrelatedExecutableFolder = path.join(root, 'Documents');
  const squirrelRoot = path.join(root, 'SquirrelProduct');
  const squirrelVersionRoot = path.join(root, 'SquirrelVersionProduct');
  const oversizedIcon = path.join(root, 'oversized.ico');
  fs.writeFileSync(executable, 'exe');
  fs.writeFileSync(iconFile, 'ico');
  fs.writeFileSync(shortcut, 'lnk');
  fs.mkdirSync(folder);
  fs.mkdirSync(portableApp);
  fs.mkdirSync(ambiguousFolder);
  fs.mkdirSync(unrelatedExecutableFolder);
  fs.mkdirSync(squirrelRoot);
  fs.mkdirSync(squirrelVersionRoot);
  fs.mkdirSync(path.join(squirrelVersionRoot, 'app-2.0.0'));
  fs.writeFileSync(path.join(portableApp, 'PortableBox.exe'), 'exe');
  fs.writeFileSync(path.join(portableApp, 'update.exe'), 'exe');
  fs.writeFileSync(path.join(ambiguousFolder, 'Alpha.exe'), 'exe');
  fs.writeFileSync(path.join(ambiguousFolder, 'Beta.exe'), 'exe');
  fs.writeFileSync(path.join(unrelatedExecutableFolder, 'viewer.exe'), 'exe');
  fs.writeFileSync(path.join(squirrelRoot, 'Update.exe'), 'exe');
  fs.writeFileSync(path.join(squirrelRoot, 'app.ico'), 'ico');
  fs.writeFileSync(path.join(squirrelVersionRoot, 'Update.exe'), 'exe');
  fs.writeFileSync(path.join(squirrelVersionRoot, 'app-2.0.0', 'Product.exe'), 'exe');
  fs.writeFileSync(oversizedIcon, 'ico');

  let extractCalls = 0;
  let shellCalls = 0;
  let folderTypeCalls = 0;
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
      createFromPath: (filePath) => ({
        isEmpty: () => false,
        toDataURL: () => filePath === oversizedIcon
          ? 'data:image/png;base64,' + 'A'.repeat(MAX_ICON_DATA_URL_LENGTH)
          : 'data:image/png;base64,direct'
      })
    },
    extractExecutableIcon: async (filePath, index) => {
      extractCalls++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return Buffer.from(`${filePath}:${index}`).toString('base64');
    },
    extractFolderTypeIcon: async () => {
      folderTypeCalls++;
      return Buffer.from('windows-folder').toString('base64');
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

  const folderIcon = await service.getIcon({ path: folder });
  assert.strictEqual(folderIcon.url, `data:image/png;base64,${Buffer.from('windows-folder').toString('base64')}`);
  assert.strictEqual(folderIcon.source, 'type-folder-shell');
  assert.strictEqual(folderIcon.fallback, false);
  assert.strictEqual(shellCalls, 0, '目录应使用 Windows 目录类型图标，而不是按真实路径取得的空白图标');
  assert.strictEqual(folderTypeCalls, 1);

  const portableIcon = await service.getIcon({ name: 'PortableBox', path: portableApp });
  assert.strictEqual(portableIcon.source, 'type-folder-shell', '目录内容即使有同名 EXE 也必须保持文件夹语义');

  const ambiguousIcon = await service.getIcon({ name: 'Unrelated', path: ambiguousFolder });
  assert.strictEqual(ambiguousIcon.source, 'type-folder-shell', '多个不匹配的 EXE 不得把普通目录误判为应用');

  const unrelatedExecutableIcon = await service.getIcon({ name: 'Documents', path: unrelatedExecutableFolder });
  assert.strictEqual(unrelatedExecutableIcon.source, 'type-folder-shell', '仅有一个无关 EXE 也不得自动判定为应用');
  assert.strictEqual(folderTypeCalls, 1, 'Windows 目录类型图标在同一服务中只提取一次');

  const oversized = await service.getIcon({ path: executable, iconPath: oversizedIcon });
  assert.strictEqual(oversized.source, 'target-resource', '超大显式图像应被拒绝并安全回退到启动目标图标');
  assert.ok(oversized.url.length <= MAX_ICON_DATA_URL_LENGTH, '超大图像数据不得进入内存和磁盘图标缓存');

  const oversizedRequest = await service.getIcon({ path: 'A'.repeat(2049) });
  assert.strictEqual(oversizedRequest.errorCode, 'NO_ICON_SOURCE');

  const squirrelIcon = findSquirrelIconSource(
    path.join(squirrelRoot, 'Update.exe'),
    '--processStart Product.exe'
  );
  assert.strictEqual(squirrelIcon.iconPath, path.join(squirrelRoot, 'app.ico'));
  assert.strictEqual(squirrelIcon.source, 'squirrel-root-icon');
  const squirrelVersionIcon = findSquirrelIconSource(
    path.join(squirrelVersionRoot, 'Update.exe'),
    '--processStart Product.exe'
  );
  assert.strictEqual(squirrelVersionIcon.iconPath, path.join(squirrelVersionRoot, 'app-2.0.0', 'Product.exe'));
  assert.strictEqual(squirrelVersionIcon.source, 'squirrel-process-resource');
  assert.strictEqual(findSquirrelIconSource('Update.exe', '--processStart Product.exe'), null);

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

  if (process.platform === 'win32') {
    const extracted = await runEncodedPowerShell(buildIconExtractScript(process.execPath), { timeoutMs: 30000 });
    const png = Buffer.from(extracted.stdout, 'base64');
    assert.strictEqual(extracted.code, 0, extracted.stderr || extracted.rawStderr);
    assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const folderExtracted = await runEncodedPowerShell(buildFolderTypeIconScript(), { timeoutMs: 30000 });
    const folderPng = Buffer.from(folderExtracted.stdout, 'base64');
    assert.strictEqual(folderExtracted.code, 0, folderExtracted.stderr || folderExtracted.rawStderr);
    assert.deepStrictEqual([...folderPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }

  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('通过 34 项，失败 0 项');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
