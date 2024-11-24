import { SchemaType } from './SchemaType.js';
import { VirtualType } from './VirtualType.js';
import { ObjectId } from 'bson';

export class Schema {
  constructor(definition, options = {}) {
    this.definition = this._parseDefinition(definition);
    this.options = options;
    this.virtuals = {};
    this.methods = {};
    this.statics = {};
    this.middleware = {
      pre: {},
      post: {}
    };
    this._indexes = [];
    this._paths = new Map();
    this._requiredPaths = new Set();
    this._plugins = new Set();
    this.childSchemas = [];
    this.discriminatorMapping = null;
    this.obj = { ...definition };

    this.reserved = {
      _id: true,
      __v: true,
      createdAt: true,
      updatedAt: true
    };

    this._init();
  }

  static get Types() {
    return {
      String: String,
      Number: Number,
      Boolean: Boolean,
      Array: Array,
      Date: Date,
      Object: Object,
      ObjectId: ObjectId,
      Mixed: Object,
      Decimal128: Number,
      Map: Map
    };
  }

  static get indexTypes() {
    return ['2d', '2dsphere', 'hashed', 'text', 'unique'];
  }

  _parseDefinition(definition) {
    const parsed = {};
    for (const [key, value] of Object.entries(definition)) {
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        if (value.type) {
          parsed[key] = {
            ...value,
            isReference: value.type === Schema.Types.ObjectId && value.ref
          };
        } else {
          parsed[key] = this._parseDefinition(value);
        }
      } else {
        parsed[key] = { type: value };
      }
    }
    return parsed;
  }

  _init() {
    for (const [path, options] of Object.entries(this.definition)) {
      this._paths.set(path, this._createSchemaType(path, options));
      if (options.required) {
        this._requiredPaths.add(path);
      }
      if (options.index) {
        this.index({ [path]: 1 });
      }
    }
  }

  add(obj) {
    for (const [path, options] of Object.entries(obj)) {
      this.definition[path] = options;
      this._paths.set(path, this._createSchemaType(path, options));
      if (options.required) {
        this._requiredPaths.add(path);
      }
    }
    return this;
  }

  alias(from, to) {
    this.virtual(from).get(function() {
      return this[to];
    });
    return this;
  }

  clone() {
    const clone = new Schema(this.definition, { ...this.options });
    clone.virtuals = { ...this.virtuals };
    clone.methods = { ...this.methods };
    clone.statics = { ...this.statics };
    clone.middleware = {
      pre: { ...this.middleware.pre },
      post: { ...this.middleware.post }
    };
    clone._indexes = [...this._indexes];
    clone._plugins = new Set([...this._plugins]);
    clone.childSchemas = [...this.childSchemas];
    return clone;
  }

  discriminator(name, schema) {
    if (!this.discriminatorMapping) {
      this.discriminatorMapping = {
        key: '_type',
        value: this.options.name || 'Base'
      };
    }
    schema.discriminatorMapping = {
      key: this.discriminatorMapping.key,
      value: name
    };
    this.childSchemas.push({ name, schema });
    return schema;
  }

  eachPath(fn) {
    this._paths.forEach((schemaType, path) => {
      fn(path, schemaType);
    });
  }

  get(key) {
    return this.options[key];
  }

  index(fields, options = {}) {
    this._indexes.push([fields, options]);
    return this;
  }

  indexes() {
    return [...this._indexes];
  }

  loadClass(model) {
    const methods = Object.getOwnPropertyNames(model.prototype)
      .filter(name => name !== 'constructor');
    
    methods.forEach(method => {
      this.method(method, model.prototype[method]);
    });
    
    const statics = Object.getOwnPropertyNames(model)
      .filter(name => typeof model[name] === 'function');
    
    statics.forEach(staticMethod => {
      this.static(staticMethod, model[staticMethod]);
    });
    
    return this;
  }

  method(name, fn) {
    this.methods[name] = fn;
    return this;
  }

  omit(paths) {
    const newSchema = this.clone();
    paths = Array.isArray(paths) ? paths : [paths];
    paths.forEach(path => {
      newSchema.remove(path);
    });
    return newSchema;
  }

  path(path) {
    return this._paths.get(path);
  }

  pathType(path) {
    if (this._paths.has(path)) return 'real';
    if (this.virtuals[path]) return 'virtual';
    if (this.reserved[path]) return 'reserved';
    return 'adhoc';
  }

  pick(paths) {
    const newSchema = new Schema({});
    paths = Array.isArray(paths) ? paths : [paths];
    paths.forEach(path => {
      if (this._paths.has(path)) {
        newSchema.add({ [path]: this.definition[path] });
      }
    });
    return newSchema;
  }

  plugin(fn, opts) {
    fn(this, opts);
    this._plugins.add(fn);
    return this;
  }

  post(action, fn) {
    if (!this.middleware.post[action]) {
      this.middleware.post[action] = [];
    }
    this.middleware.post[action].push(fn);
    return this;
  }

  pre(action, fn) {
    if (!this.middleware.pre[action]) {
      this.middleware.pre[action] = [];
    }
    this.middleware.pre[action].push(fn);
    return this;
  }

  queue(name, args) {
    if (!this._queue) this._queue = new Map();
    if (!this._queue.has(name)) this._queue.set(name, []);
    this._queue.get(name).push(args);
    return this;
  }

  remove(path) {
    delete this.definition[path];
    this._paths.delete(path);
    this._requiredPaths.delete(path);
    return this;
  }

  removeIndex(path) {
    this._indexes = this._indexes.filter(([fields]) => !fields[path]);
    return this;
  }

  removeVirtual(path) {
    delete this.virtuals[path];
    return this;
  }

  requiredPaths(invalidate = false) {
    if (invalidate) {
      this._requiredPaths.clear();
      this.eachPath((path, schemaType) => {
        if (schemaType.required()) {
          this._requiredPaths.add(path);
        }
      });
    }
    return Array.from(this._requiredPaths);
  }

  set(key, value) {
    this.options[key] = value;
    return this;
  }

  static(name, fn) {
    this.statics[name] = fn;
    return this;
  }

  virtual(name) {
    if (!this.virtuals[name]) {
      this.virtuals[name] = new VirtualType(name);
    }
    return this.virtuals[name];
  }

  virtualpath(name) {
    return this.virtuals[name];
  }

  get paths() {
    return Object.fromEntries(this._paths);
  }

  _createSchemaType(path, options) {
    const type = options.type || options;
    const schemaTypeOptions = typeof options === 'object' ? options : {};
    return new SchemaType(path, schemaTypeOptions, type);
  }

  validate(data) {
    const errors = [];
    for (const [path, schemaType] of this._paths.entries()) {
      if (schemaType.required() && data[path] == null) {
        errors.push(`${path} is required`);
        continue;
      }

      if (data[path] != null) {
        try {
          const value = schemaType.cast(data[path]);
          schemaType.doValidate(value, (err) => {
            if (err) errors.push(err.message);
          }, data);
        } catch (err) {
          errors.push(`${path} validation failed: ${err.message}`);
        }
      }
    }
    return errors;
  }
}