let ivm = require('isolated-vm');
let isolate = new ivm.Isolate({ memoryLimit: 128 });

let context = isolate.createContextSync();

let jail = context.globalReference();

jail.setSync('global', jail.derefInto());

jail.setSync('_ivm', ivm);

jail.setSync('_log', new ivm.Reference(function(...args) {
  console.log(...args);
}));
jail.setSync('_dir', new ivm.Reference(function(...args) {
  console.dir(...args);
}));

jail.setSync('_require', new ivm.Reference(function(packageName) {

  const pack = require(packageName);

  // transform all fns in references

  const makeRefs = (object) => {
    // if it's a function, ref it
    if (typeof object === 'function') {
      return new ivm.Reference(object);
      // return new ivm.Reference(function(...args) {
      //   return object(...args);
      //   const data = object(...args);
      //   return new ivm.ExternalCopy(data).copyInto();
      // });
    }

    // if it's an array map on it and cycle this
    if (Array.isArray(object)) {
      return object.map(x => makeRefs(x));
    }

    // if it's an object map on its kets and cycle this
    if (typeof object === 'object' && object !== null) {
      const keys = Object.keys(object);
      const newObj = {};
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];

        newObj[key] = makeRefs(object[key]);
      }
      return newObj;
    }

    // if it's a primitive just pass it
    // might fail on promises though
    return object;
  };

  const repacked = makeRefs(pack);

  let out;
  if (repacked instanceof ivm.Reference) {
    out = repacked;
  } else {
    out = new ivm.Reference(repacked);
  }
  return out;
}));

const bootstrap = isolate.compileScriptSync('(' + (function() {
  let ivm = _ivm;
  delete _ivm;

  let log = _log;
  delete _log;
  global.log = function(...args) {
    log.applySync(undefined, args.map(arg => new ivm.ExternalCopy(arg).copyInto()));
  };

  let dir = _dir;
  delete _dir;
  global.dir = function(...args) {
    dir.applySync(undefined, args.map(arg => new ivm.ExternalCopy(arg).copyInto()));
  };

  let require = _require;
  delete _require;

  const fixFnsInRequire = global.fixFnsInRequire = (object) => {

    // this might conflict with a genuine module that contains typeof as a string === 'function'
    if (object.typeof === 'function') {
      return (...args) => {
        global.log('will apply on', object, args);
        global.log('apply?', typeof object.apply, 'applySync?', typeof object.applySync);
        return object.applySync(undefined, args.map(arg => new ivm.ExternalCopy(arg).copyInto()));
      }
    }

    if (Array.isArray(object)) {
      return object.map(x => fixFnsInRequire(x));
    }

    if (typeof object === 'object' && object !== null) {
      const keys = Object.keys(object);
      const newObject = {};
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        newObject[key] = fixFnsInRequire(object[key]);
      }
      return newObject;
    }

    return object;
  };

  global.requireNative = function(packageName) {
    if (global.requireNative.cache.has(packageName)) {
      global.log('returned cached', packageName);
      return global.requireNative.cache.get(packageName);
    }

    const pack = require.applySync(undefined, [packageName]);
    global.log('required', packageName);
    const unpacked = pack;fixFnsInRequire(pack);

    global.requireNative.cache.set(packageName, unpacked);
    return unpacked;
  };
  global.requireNative.cache = new Map();

}) + ')()');

bootstrap.runSync(context);

isolate.compileScriptSync('(' + (async () => {

  // const uuid = global.requireNative('uuid');
  const fs = global.requireNative('fs');

  // global.log('uuid:', uuid());
  // global.log('uuid:', global.requireNative('uuid')());

  global.dir(fs.deref());
  // global.dir(Object.keys(fs));
  // global.dir(fs.existsSync('./'));
  // global.log(fs.readFileSync('./package.json'));

}) + ')();').runSync(context);


// setInterval(() => {}, 100);