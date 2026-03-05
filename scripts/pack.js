const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// 辅助函数：复制文件（如果目标不存在或源更新）
// 实际上此脚本主要用于打包 zip，不涉及复杂复制，archiver 可直接添加文件/目录

async function pack() {
  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  
  // 读取版本号
  let version = '0.1.0';
  try {
    const pkg = require(path.join(root, 'package.json'));
    if (pkg.version) version = pkg.version;
  } catch (e) {
    console.warn('Warn: 无法读取 package.json 版本号，使用默认值', version);
  }

  // 确保 dist 存在
  if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist, { recursive: true });
  }

  const zipPath = path.join(dist, `LightMonitor-${version}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // 最高压缩级别
  });

  output.on('close', () => {
    console.log(`打包完成: ${zipPath}`);
    console.log(`总大小: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
  });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      console.warn(err);
    } else {
      throw err;
    }
  });

  archive.on('error', (err) => {
    throw err;
  });

  archive.pipe(output);

  // 添加文件和目录
  console.log('正在打包...');
  
  const items = ['server', 'public', 'scripts', 'docs', 'package.json', 'README_OFFLINE.txt'];
  
  for (const item of items) {
    const p = path.join(root, item);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        archive.directory(p, item);
      } else {
        archive.file(p, { name: item });
      }
    } else {
      console.warn(`跳过缺失项: ${item}`);
    }
  }

  // 特殊处理：node_modules (必须包含)
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) {
    console.log('添加 node_modules (这可能需要一些时间)...');
    archive.directory(nm, 'node_modules');
  } else {
    console.warn('警告: node_modules 不存在！打包出的程序可能无法运行。请先运行 npm install。');
  }

  // 特殊处理：package-lock.json (如果存在)
  const lock = path.join(root, 'package-lock.json');
  if (fs.existsSync(lock)) {
    archive.file(lock, { name: 'package-lock.json' });
  }

  await archive.finalize();
}

pack().catch(err => {
  console.error('打包失败:', err);
  process.exit(1);
});
