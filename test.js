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
jail.setSync('__apply_module_function', new ivm.Reference(function(moduleName, trace, args) {

  let pointer = require(moduleName);
  trace.forEach(link => pointer = pointer[link]);

  const result = pointer(...args);

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
        return _apply_module_function.applySync(
          undefined,
          [
            moduleName, trace, args
          ].map(x => new ivm.ExternalCopy(x).copyInto())
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

  const _package = requireNative('fs');

  log('fs is', _package);
  log('fs.existsSync', typeof _package.existsSync);
  log('fs.existsSync(".")', _package.existsSync('.'));

}) + ')()').runSync(context);
