/**
 * @file npm 发布脚本，生成 lib 和 es 目录
 * @author wangyongqing <wangyongqing01@baidu.com>
 */


// TODO:
// 1. 获取当前版本
// 2. 输入新的版本号
// 3. 执行 npm version
// 4. 开始下面的流程生成 dest 内容
// 5. 手动发包？还是直接 exec？暂时手动吧，方便调试 release 脚本
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const execa = require('execa');
const semver = require('semver');
const inquirer = require('inquirer');
const rd = require('rd');

const babel = require('./lib/babel');
const copyFile = require('./lib/copy-file');
const rollup = require('./lib/rollup');

async function genLessFile() {
    await new Promise((resolve) => {
        const componentsPath = path.join(process.cwd(), 'src');
        let componentsLessContent = '';

        fs.readdir(componentsPath, (err, files) => {
            files.forEach(file => {
                if (fs.existsSync(path.join(componentsPath, file, 'style', 'index.less'))) {
                    componentsLessContent += `@import "../${path.join(file, 'style', 'index.less')}";\n`;
                }
            });
            fs.writeFileSync(
                path.join(process.cwd(), 'dest', 'lib', 'core', 'styles', 'components.less'),
                componentsLessContent,
            );
        });

        if (fs.existsSync(path.join(process.cwd(), 'dest'))) {
            fs.writeFileSync(
                path.join(process.cwd(), 'dest', 'dist', 'santd.less'),
                '@import "../lib/core/styles/index.less";\n@import "../lib/core/styles/components.less";',
            );
            console.log('Built a entry less file to dist/santd.less');
        }
        resolve();
    });
}

async function main() {
    console.log('Release Santd...');
    const pkg = await getPackageJson();
    // const version = await getReleaseVersion(pkg.version);
    const dest = await getDestDir();
    const src = path.resolve('src');

    await genFiles(dest, src, pkg.version, pkg);
    await genLessFile();

    ['README.md', 'package.json'].forEach(f => {
        fs.copyFileSync(path.join(__dirname, `../${f}`), path.join(dest, f));
    });

    // await execa('npm', ['version', version], {stdio: 'inherit', cwd: dest});
    console.log('success build.');

    const workDir = process.cwd();
    console.log(`已经生成 Santd，在 ${path.relative(workDir, dest)} 文件夹`);
    console.log('确定发包手动执行：npm publish --registry http://registry.npmjs.com');
}

async function getPackageJson() {
    return require('../package.json');
}

async function getReleaseVersion(current = '0.1.0') {
    try {
        current = execa.commandSync('npm view santd version --registry http://registry.npmjs.com').stdout.trim();
    }
    catch (e) {
        if (!~e.toString().indexOf('404 no such package available')) {
            console.log(e);
            process.exit(1);
        }
        else {
            return current;
        }
    }

    console.log('Santd current version is: ' + current);

    const bumps = ['patch', 'minor', 'major', 'prerelease'];
    const versions = {};
    bumps.forEach(b => {
        versions[b] = semver.inc(current, b);
    });

    const bumpChoices = bumps.map(b => ({name: `${b} (${versions[b]})`, value: b}));
    const {bump, customVersion} = await inquirer.prompt([
        {
            name: 'bump',
            message: 'Select release type:',
            type: 'list',
            choices: [...bumpChoices, {name: 'custom', value: 'custom'}]
        },
        {
            name: 'customVersion',
            message: 'Input version:',
            type: 'input',
            when: answers => answers.bump === 'custom'
        }
    ]);

    const version = customVersion || versions[bump];

    const answer = await inquirer.prompt([
        {
            name: 'yes',
            message: `Confirm releasing Santd@v${version}?`,
            type: 'confirm'
        }
    ]);
    if (answer.yes) {
        return version;
    }
    else {
        process.exit(1);
    }
}

async function getDestDir() {
    const dest = path.resolve('dest');
    if (fsExtra.pathExistsSync(dest)) {
        fsExtra.removeSync(dest);
        fsExtra.mkdirSync(dest);
    }
    return dest;
}

async function genFiles(dest, src, version, pkg) {
    // 先输出es5版本
    console.log('starting package es5 version...');
    const es5Dest = path.join(dest, 'lib');
    const exclude = ['*/docs/**', '*/__tests__/**', './node_modules/**'];
    fsExtra.mkdirpSync(es5Dest);
    await babel(src, es5Dest, {
        pkgName: 'santd',
        exclude,
        babelPlugins: [
            require('@babel/plugin-syntax-dynamic-import'),
            require('@babel/plugin-syntax-import-meta'),
            require('@babel/plugin-proposal-class-properties'),
            require('@babel/plugin-transform-new-target'),
            require('@babel/plugin-transform-modules-commonjs')
        ]
    });
    console.log('starting package es6 version...');
    await copyFile(src, path.join(dest, 'es'), (content, file, cb) => {
        content = content.split('\n').filter(c => c.indexOf('style/index') === -1);
        file.contents = Buffer.from(content.join('\n'));
        cb(null, file);
    }, exclude);

    console.log('starting package less file...');
    let files = rd.readSync(es5Dest);
    files = files.filter(file => file.indexOf('style/index.less') !== -1);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const parsedFile = path.parse(file);
        const lessc = path.join(__dirname, '../node_modules/less/bin/lessc');
        await execa(lessc, ['--js', 'index.less', 'index.css'], {cwd: `${parsedFile.dir}`});
        const es6Path = parsedFile.dir.replace('lib', 'es');
        await fsExtra.copy(`${parsedFile.dir}/index.css`, `${es6Path}/index.css`);
        // 删除不必要的文件
        await fsExtra.remove(`${es6Path.replace('/style', '')}/__tests__`);
        await fsExtra.remove(`${es6Path.replace('/style', '')}/docs`);
    }

    console.log('starting package all in one file...');
    await rollup(path.join(dest, 'dist'), path.join(dest, 'es', 'index.js'));
}

main();