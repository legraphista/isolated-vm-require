let ivm = require('isolated-vm');
let isolate = new ivm.Isolate({ memoryLimit: 128 });

let context = isolate.createContextSync();

let jail = context.globalReference();

jail.setSync('global', jail.derefInto());

(async () => {

  const bootstrap = require('./bootstrap');
  await bootstrap.async({
    isolate,
    context
  });
  const script = isolate.compileScriptSync('(' + (async () => {

    const dns = await requireNativeAsync('dns');

    log('dns.getServers', await dns.getServers());
    log('dns.lookup', await dns.lookup('google.ro', 6, (err, address, family) => log('dns.lookup eventual result:', address, family)));

    const fs = await requireNativeAsync('fs');

    const file = './package.json';
    const f1 = (await fs.readFileSync(file)).toString();
    log('package sync len', f1.length);

    const f2 = (await new Promise((res, rej) => {
      fs.readFile(file, (err, data) => {
        if (err) {
          return rej(err);
        }

        return res(data);
      });
    })).toString();

    log('package async len', f2.length);
    log('sync === async (file reads)', f1 === f2);

  }) + ')()');

  script.run(context).catch(console.error);
  console.log('hello');

// test
//   const script = isolate.compileScriptSync('(' + (async () => {
//
//     const dns = requireNative('dns');
//
//     log('dns.getServers', dns.getServers());
//     log('dns.lookup', dns.lookup('google.ro', 6, (err, address, family) => log('dns.lookup eventual result:', address, family)));
//
//     const fs = requireNative('fs');
//
//     const file = './package.json';
//     const f1 = fs.readFileSync(file).toString();
//     log('package sync len', f1.length);
//
//     const f2 = (await new Promise((res, rej) => {
//       fs.readFile(file, (err, data) => {
//         if (err) {
//           return rej(err);
//         }
//
//         return res(data);
//       });
//     })).toString();
//
//     log('package async len', f2.length);
//     log('sync === async (file reads)', f1 === f2);
//
//   }) + ')()');
//
//   script.runSync(context);
//   console.log('hello');
})();
