// Pass in a mori object, based on a mori build
// which exposes protocols via `mori.extend`
module.exports = function(mori) {
  
  var inherits      = require('inherits');
  var isPlainObject = require('lodash.isplainobject');
  var EventEmitter  = require('events').EventEmitter;

  // The base Cursor constructor, used by the 
  // MapCursor and VectorCursor. Implements the 
  // ILookup, IHash, IEquiv, ICloneable, IAssociative
  // ICounted, IEncodeClojure, IKVReduce, ISeqable
  // ICollection, IEncodeJS CLJS protocols.
  function Cursor(value, root, path) {
    this.value = value;
    this.root  = root;
    this.path  = path != null ? path : mori.vector();
    if (!mori.is_collection(this.path)) {
      this.path = mori.js_to_clj(this.path);
    }
  }

  Cursor.prototype.toString = function() {
    return this.value.toString();
  };

  Cursor.prototype.toJS = function() {
    return mori.clj_to_js(this.value);
  };

  Cursor.prototype.count = function() {
    return mori.count(this.value);
  };

  Cursor.prototype.map = function(fn) {
    return mori.map(fn, this);
  };

  Cursor.prototype.get = function(k, notFound) {
    if (Array.isArray(k)) {
      return mori.get_in(this, k, notFound);
    } else {
      return mori.get(this, k, notFound);
    }
  };

  Cursor.prototype.lookup = function(k, notFound) {
    var val = mori.get(this.value, k, notFound);
    if (!mori.equals(val, notFound)) {
      return toCursor(val, this.root, mori.conj(this.path, k));
    }
    return notFound;
  };

  Cursor.prototype.assoc = function(k, v) {
    return toCursor(mori.assoc(this.value, k, v), this.root, this.path);
  };

  Cursor.prototype.clone = function() {
    return new this.constructor(this.value, this.root, this.path);
  };

  Cursor.prototype.hash = function() {
    return mori.hash(this.value);
  };

  Cursor.prototype.contains_key = function() {
    return mori.contains_key(this.value, k);
  };

  Cursor.prototype.equiv = function(other) {
    if (other instanceof Cursor) {
      return mori.equals(this.value, other.value);
    } else {
      return mori.equals(this.value, other);
    }
  };

  // Allows the IEncodeClojure to know this is a
  // ClojureScript object. Dependent on 
  // http://dev.clojure.org/jira/browse/CLJS-842
  Cursor.prototype.toClj = function() {
    return this;
  };

  Cursor.prototype.reduce_kv = function(fn, init) {
    if (arguments.length === 1) {
      return mori.reduce_kv(fn, this.value);
    } else {
      return mori.reduce_kv(fn, init, this.value);
    }
  };

  Cursor.prototype.conj = function(o) {
    return new MapCursor(mori.conj1(this.value, o), this.root, this.path);
  };

  Cursor.prototype.seq = function() {
    if (mori.count(this) > 0) {
      return mori.map((function(cursor) {
        return function(val) {
          var k, v;
          k = mori.get(val, 0);
          v = mori.get(val, 1);
          return mori.vector(k, toCursor(v, cursor.root, mori.conj(cursor.path, k)));
        };
      })(this), this.value);
    }
  };

  // "Transact" the current value of the cursor, returning a
  // hash of `oldValue`, `newValue`, `oldRoot`, 
  // `newRoot`, `path`, `tag`
  Cursor.prototype.transact = function(keyOrKeys, fn, tag) {
    switch (arguments.length) {
      case 1: return this.transact(null, keyOrKeys, null);
      case 2: return this.transact(keyOrKeys, fn, null);
    }
    var path = normalizePath(this.path, keyOrKeys);
    return _transact(this.root, this, path, fn, tag);
  };

  // Update the cursor, calling `cursor.transact`
  // but just changing the value.
  Cursor.prototype.update = function(keyOrKeys, v, tag) {
    if (arguments.length === 1) {
      return this.transact([], function() {
        return keyOrKeys;
      });
    }
    return this.transact(keyOrKeys, function() {
      return v;
    }, tag);
  };

  // Calls "swap", which swaps out the underlying value of the cursor but 
  // doesn't trigger any events / updates. Returns the updated cursor.
  Cursor.prototype.swap = function(keyOrKeys, fn) {
    if (arguments.length === 1) return this.swap(null, keyOrKeys);
    var path = normalizePath(this.path, keyOrKeys);
    var newRootVal = _swap(this.root, path, fn);
    return toCursor(mori.get_in(newRootVal, this.path), this.root, this.path);
  };

  // Like swap, but takes a key / value rather than a fn.
  Cursor.prototype.set = function(keyOrKeys, val) {
    if (arguments.length === 1) return this.swap(null, keyOrKeys);
    var path = normalizePath(this.path, keyOrKeys);
    var newRootVal = _swap(this.root, path, function() {
      return val;
    });
    return toCursor(mori.get_in(newRootVal, this.path), this.root, this.path);
  };

  mori.extend("ILookup", Cursor.prototype, {
    lookup: Cursor.prototype.lookup
  });
  mori.extend("IHash", Cursor.prototype, {
    hash: Cursor.prototype.hash
  });
  mori.extend("IEquiv", Cursor.prototype, {
    equiv: Cursor.prototype.equiv
  });
  mori.extend("ICloneable", Cursor.prototype, {
    clone: Cursor.prototype.clone
  });
  mori.extend("IAssociative", Cursor.prototype, {
    contains_key: Cursor.prototype.contains_key,
    assoc: Cursor.prototype.assoc
  });
  mori.extend("ICounted", Cursor.prototype, {
    count: Cursor.prototype.count
  });
  mori.extend("IEncodeClojure", Cursor.prototype, {
    toClj: Cursor.prototype.toClj
  });
  mori.extend("IKVReduce", Cursor.prototype, {
    reduce_kv: Cursor.prototype.reduce_kv
  });
  mori.extend("ISeqable", Cursor.prototype, {
    seq: Cursor.prototype.seq
  });
  mori.extend("ICollection", Cursor.prototype, {
    conj: Cursor.prototype.conj
  });
  mori.extend("IEncodeJS", Cursor.prototype, {
    toJS: Cursor.prototype.toJS
  });

  // Creates a new vector-specific cursor, allowing an array
  // to be passed as the first argument.
  function VectorCursor(value, root, path) {
    if (Array.isArray(value)) {
      vector = value.reduce(function(acc, val, k) {
        return mori.assoc(acc, k, val);
      }, mori.vector());
    }
    Cursor.call(this, value, root, path);
  }
  inherits(VectorCursor, Cursor);

  VectorCursor.prototype.first = function() {
    return toCursor(mori.first(this.value), this.root, mori.conj1(this.path, 0));
  };

  VectorCursor.prototype.rest = function() {
    return toCursor(mori.rest(this.value), this.root, this.path);
  };

  VectorCursor.prototype.conj = function(o) {
    return new VectorCursor(mori.conj1(this.value, o), this.root, this.path);
  };

  VectorCursor.prototype.seq = function() {
    if (mori.count(this) > 0) {
      return mori.map((function(cursor) {
        return function(v, i) {
          return toCursor(v, cursor.root, mori.conj1(cursor.path, i));
        };
      })(this), this.value, mori.range());
    }
  };

  VectorCursor.prototype.reduce = function(fn, acc) {
    return mori.reduce(fn, acc, this);
  };

  // Create a new MapCursor, allowing for plain objects to be passed in
  // and converted to a new MapCursor.
  function MapCursor(value, root, path) {
    
    // This can be simplified to `value = mori.js_to_clj(value)`
    // once the IEncodeClojure protocol is patched.
    if (isPlainObject(value)) {
      var hash_map = mori.mutable.thaw(mori.hash_map());
      for (var k in value) {
        mori.mutable.assoc(hash_map, k, value[k]);
      }
      value = mori.mutable.freeze(hash_map);
    }
    Cursor.call(this, value, root, path);
  }
  inherits(MapCursor, Cursor);

  MapCursor.prototype.dissoc = function(k) {
    return toCursor(mori.dissoc(this.value, k), this.root, this.path);
  };

  MapCursor.prototype.reduce = function(fn, acc) {
    return mori.reduce_kv(fn, acc, this);
  };

  // "extend" the MapCursor with various MapCursor specific protocols.
  mori.extend("IMap", MapCursor.prototype, {
    dissoc: MapCursor.prototype.dissoc
  });
  mori.extend("ISeqable", VectorCursor.prototype, {
    seq: VectorCursor.prototype.seq
  });
  mori.extend("ICollection", VectorCursor.prototype, {
    conj: VectorCursor.prototype.conj
  });
  mori.extend("ISeq", VectorCursor.prototype, {
    first: VectorCursor.prototype.first,
    rest: VectorCursor.prototype.rest
  });

  // Update a value in a pseudo-transaction. The updated value
  // is determined and sent as tx_data 
  function _transact(root, cursor, path, fn, tag) {
    if (typeof fn !== "function") {
      throw new Error('A function is required for cursor transact / update');
    }
    var oldRoot = root.value;
    var newRoot = _swap(root, path, fn);
    var tx_data = mori.hash_map(
      'path',     path,
      'oldValue', mori.get_in(oldRoot, path),
      'newValue', mori.get_in(newRoot, path),
      'oldRoot',  oldRoot,
      'newRoot',  newRoot,
      'tag',      tag
    );
    root.emit('transact', tx_data, cursor);
    return tx_data;
  }
  
  // Shared helper for the internal "swap!"
  function _swap(root, path, fn) {
    if (mori.is_empty(path)) {
      root.value = fn(root.value);
    } else {
      root.value = mori.update_in(root.value, path, fn);
    }
    return root.value;
  }

  function toCursor(val, root, path) {
    switch (arguments.length) {
      case 1: throw new Error('The root is required to build a cursor');
      case 2: return toCursor(val, root, []);
    }
    if (val instanceof Cursor) return val;
    if (val != null && typeof val.toCursor === 'function') {
      return val.toCursor(root, path);
    }
    if (mori.is_indexed(val) || Array.isArray(val)) {
      return new VectorCursor(val, root, path);
    }
    if (mori.is_map(val) || val && typeof val === 'object') {
      return new MapCursor(val, root, path);
    }
    return val;
  }

  // The "root cursor" serves a similar function to an "atom" in clojurescript,
  // exposing a "swap" method which allows updating the value in place. The
  // root cursor.
  function RootCursor(data) {
    if (isPlainObject(data) || Array.isArray(data)) {
      data = mori.js_to_clj(data);
    }
    this.value = data;
    this.root  = this;
    this.path  = mori.vector();
  }
  inherits(RootCursor, MapCursor);

  // Make the RootCursor an EventEmitter.
  for (var k in EventEmitter.prototype) {
    RootCursor.prototype[k] = EventEmitter.prototype[k];
  }

  // Normalizes key or keys passed to any of the update / transact / swap.
  function normalizePath(path, keyOrKeys) {
    if (keyOrKeys == null) return path;
    if (Array.isArray(keyOrKeys)) keyOrKeys = mori.js_to_clj(keyOrKeys);
    if (!mori.is_sequential(keyOrKeys)) keyOrKeys = mori.vector(keyOrKeys);
    return mori.into(path, keyOrKeys);
  }

  // Cursor namespace
  mori.cursor = {};

  // Public protocol:
  mori.cursor.Map = function Map_Cursor(value, root, path) {
    return new MapCursor(value, root, path);
  };
  mori.cursor.Vector = function Vector_Cursor(value, root, path) {
    return new VectorCursor(value, root, path);
  };
  mori.cursor.Root = function Root_Cursor(data) {
    return new RootCursor(data);
  };
  mori.cursor.toCursor  = toCursor;

  return mori;
};