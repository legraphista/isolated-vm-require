let ivm = require('isolated-vm');
let isolate = new ivm.Isolate({ memoryLimit: 128 });
let context = isolate.createContextSync();
let jail = context.globalReference();

jail.setSync('global', jail.derefInto());
jail.setSync('_ivm', ivm);
jail.setSync('_log', new ivm.Reference(function(...args) {
  console.log(...args);
}));

const fn = (a) => a;
const ref = new ivm.Reference(fn);
const ref2 = new ivm.Reference({});
ref2.setSync('fn', ref);

console.log('main isolate: fn ref is',      ref2.getSync('fn').constructor.name);
console.log('main isolate: fn ref type is', ref2.getSync('fn').typeof);

console.log('main isolate: fn(1) is',       ref2.getSync('fn').deref().constructor.name);
console.log('main isolate: fn(1) type is',  ref2.getSync('fn').deref().typeof);
console.log('main isolate: fn(1) is',       ref2.getSync('fn').deref().applySync(undefined, [1]));

jail.setSync('_ref', ref2);

const bootstrap = isolate.compileScriptSync('(' + (() => {
  let ivm = _ivm;
  delete _ivm;

  let log = _log;
  delete _log;
  global.log = function(...args) {
    log.applySync(undefined, args.map(arg => new ivm.ExternalCopy(arg).copyInto()));
  };

  global.log('child isolate: fn is',      _ref.getSync('fn').constructor.name);
  global.log('child isolate: fn type is', _ref.getSync('fn').typeof);

  try{
    global.log('child isolate: fn(1) is', _ref.getSync('fn').deref().applySync(undefined, [1]));
  }catch (ex) {
    global.log(ex.stack);
  }

  global.log('child isolate: copy of fn looks like', _ref.getSync('fn').copySync());
  global.log('child isolate: copy of fn is',         _ref.getSync('fn').copySync().constructor.name);

}) + ')()');

bootstrap.runSync(context);
