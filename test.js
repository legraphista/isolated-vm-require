let ivm = require('isolated-vm');
let isolate = new ivm.Isolate({ memoryLimit: 128 });

let context = isolate.createContextSync();

let jail = context.globalReference();

jail.setSync('global', jail.derefInto());

jail.setSync('_ivm', ivm);

jail.setSync('_log', new ivm.Reference(function(...args) {
  console.log(...args);
}));

const packModuleFunctions = (module) => {
  return packModuleFunctions.pack(module);
};
packModuleFunctions.pack = (value) => {
  if (typeof value === 'function') {
    return {
      type: 'function',
      value: undefined
    }
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      value: value.map((x, i) => packModuleFunctions.pack(x))
    };
  }

  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    const newObj = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      newObj[key] = packModuleFunctions.pack(value[key]);
    }
    return {
      type: 'object',
      value: newObj
    };
  }

  return {
    type: 'primitive',
    value: value
  };
};

jail.setSync('__require_packed_module', new ivm.Reference(function(moduleName) {
  return new ivm.ExternalCopy(packModuleFunctions(require(moduleName))).copyInto();
}));
jail.setSync('__apply_module_function', new ivm.Reference(function(moduleName,
                                                                   trace,
                                                                   args,
                                                                   potentialCallbackRef) {

  console.log('potential callback?', potentialCallbackRef);

  const potentialCallback = potentialCallbackRef ?
    (...args) =>
      potentialCallbackRef.applySync(undefined, args.map(x => new ivm.ExternalCopy(x).copyInto())) :
    undefined;


  let pointer = require(moduleName);
  trace.forEach(link => pointer = pointer[link]);

  const result = pointer(...(args.concat(potentialCallback || [])));

  return new ivm.ExternalCopy(result).copyInto();
}));

// bootstrap
isolate.compileScriptSync('(' + (() => {

  let ivm = _ivm;
  delete _ivm;

  let log = _log;
  delete _log;
  global.log = function(...args) {
    log.applySync(undefined, args.map(arg => new ivm.ExternalCopy(arg).copyInto()));
  };

  let _require_packed_module = __require_packed_module;
  let _apply_module_function = __apply_module_function;
  delete __require_packed_module;
  delete __apply_module_function;

  global.requireNative = (moduleName) => {
    const packedModule = _require_packed_module.applySync(undefined, [moduleName]);
    global.requireNative._bindPackedModule(moduleName, packedModule, []);
    return global.requireNative._unpackPackedModule(packedModule);
  };
  global.requireNative._bindPackedModule = (moduleName, pack, trace) => {
    if (pack.type === 'function') {
      pack.value = (...args) => {
        const potentialCallback = typeof args[args.length - 1] === 'function' ?
          args.pop() :
          undefined;

        const potentialCallbackRef = potentialCallback ?
          new ivm.Reference(potentialCallback) :
          undefined;

        return _apply_module_function.applySync(
          undefined,
          [
            moduleName, trace, args
          ]
            .map(x => new ivm.ExternalCopy(x).copyInto())
            .concat(potentialCallbackRef || [])
        );
      }
    } else if (pack.type === 'array') {
      pack
        .value
        .forEach((packet, index) =>
          global.requireNative._bindPackedModule(moduleName, packet, trace.concat(index))
        );
    } else if (pack.type === 'object') {
      const keys = Object.keys(pack.value);
      keys.forEach(key => {
        const packet = pack.value[key];
        global.requireNative._bindPackedModule(moduleName, packet, trace.concat(key));
      });
    }
  };
  global.requireNative._unpackPackedModule = (pack) => {
    if (pack.type === 'array') {
      return pack.value.map(packet => global.requireNative._unpackPackedModule(packet));
    }
    if (pack.type === 'object') {
      const keys = Object.keys(pack.value);
      const newObj = {};
      keys.forEach(key => {
        const packet = pack.value[key];
        newObj[key] = global.requireNative._unpackPackedModule(packet);
      });
      return newObj;
    }

    // for functions and primitives we just pass through
    return pack.value;
  };

}) + ')()').runSync(context);


// test
isolate.compileScriptSync('(' + (() => {

  const dns = requireNative('dns');

  // log('dns is', dns);
  // log('dns keys', Object.keys(dns));
  log('dns.getServers', dns.getServers());
  log('dns.lookup', dns.lookup('google.ro', 6, (err, address, family) => log(address, family)));

  const fs = requireNative('fs');

  const file = './package.json';
  const f1 = fs.readFileSync(file).toString();
  log('package sync', f1);

  fs.readFile(file, (e, data) => {
    const f2 = data.toString();
    log('package async', f2);

    log('f1 === f2', f1 === f2);
  });


}) + ')()').runSync(context);
