// Pass in a mori object, based on a mori build
// which exposes protocols via `mori.extend`
module.exports = function(mori) {
  "use strict";

  var inherits      = require('inherits');
  var isPlainObject = require('lodash.isplainobject');
  var isArray       = require('lodash.isarray');
  
  // Inherited by the MapCursor, IndexedCursor.
  function Cursor() {}
  Cursor.prototype.hash = function() {
    return mori.hash(this.value);
  };
  Cursor.prototype.count = function() {
    return mori.count(this.value);
  };
  Cursor.prototype.clone = function() {
    return new this.constructor(this.value, this.root, this.path);
  };
  Cursor.prototype._equiv = function(other) {
    if (isCursor(other)) {
      return mori.equals(this.value, other.value);
    } else {
      return mori.equals(this.value, other);
    }
  };
  Cursor.prototype.lookup = function(k, notFound) {
    var val;
    switch (arguments.length) {
      case 1: val = mori.get(this.value, k); break;
      case 2: val = mori.get(this.value, k, notFound); break;
    }
    if (!mori.equals(val, notFound)) {
      return toCursor(val, this.root, mori.conj1(this.path, k));
    }
    return notFound;
  };
  Cursor.prototype.toString = function() {
    return '' + this.value;
  };
  Cursor.prototype.toJS = function() {
    return mori.clj_to_js(this.value);
  };
  Cursor.prototype.inspect = function() {
    return this.toString();
  };

  // Dependent on http://dev.clojure.org/jira/browse/CLJS-842
  Cursor.prototype.toClj = function() {
    return this;
  };

  mori.extend(Cursor.prototype, {
    ILookup: {
      lookup: Cursor.prototype.lookup
    },
    IHash: {
      hash: Cursor.prototype.hash
    },
    IEquiv: {
      equiv: function() {
        return this._equiv.apply(this, arguments);
      }
    },
    IEncodeClojure: {
      toClj: Cursor.prototype.toClj
    },
    IEncodeJS: {
      toJS: Cursor.prototype.toJS
    },
    ICounted: {
      count: Cursor.prototype.count
    },
    ICloneable: {
      clone: Cursor.prototype.clone
    }
  });

  // A seqable cursor is a vector or a map specific cursor.
  function SeqableCursor(value, root, path) {
    this.value    = value;
    this.root     = root;
    this.path     = path || mori.vector();
  }
  inherits(SeqableCursor, Cursor);

  SeqableCursor.prototype.assoc = function(k, v) {
    invariant(!isArray(k), 'Arrays may not be keys in seqable cursors');
    return toCursor(mori.assoc(this.value, k, v), this.root, this.path);
  };
  SeqableCursor.prototype.contains_key = function(k) {
    return mori.contains_key(this.value, k);
  };
  SeqableCursor.prototype.reduce_kv = function(fn, init) {
    if (arguments.length === 1) {
      return mori.reduce_kv(fn, this.value);
    }
    return mori.reduce_kv(fn, init, this.value);
  };
  SeqableCursor.prototype.conj = function(o) {
    return new MapCursor(mori.conj1(this.value, o), this.root, this.path);
  };

  mori.extend(SeqableCursor.prototype, {
    IAssociative: {
      contains_key: SeqableCursor.prototype.contains_key,
      assoc: SeqableCursor.prototype.assoc
    },
    IKVReduce: {
      reduce_kv: SeqableCursor.prototype.reduce_kv
    },
    ICollection: {
      conj: SeqableCursor.prototype.conj
    }
  });

  function IndexedCursor(value, root, path) {
    SeqableCursor.apply(this, arguments);
  }
  inherits(IndexedCursor, SeqableCursor);

  IndexedCursor.prototype.nth = function(k, notFound) {
    switch (arguments.length) {
      case 1: return toCursor(mori.nth(this.value, k), this.root, mori.conj1(this.path, k));
      case 2: return toCursor(mori.nth(this.value, k, notFound), mori.conj1(this.path, k));
    }
  };
  IndexedCursor.prototype.first = function() {
    return toCursor(mori.first(this.value), this.root, mori.conj1(this.path, 0));
  };
  IndexedCursor.prototype.rest = function() {
    return toCursor(mori.rest(this.value), this.root, this.path);
  };
  IndexedCursor.prototype.conj = function(o) {
    return new IndexedCursor(mori.conj1(this.value, o), this.root, this.path);
  };
  IndexedCursor.prototype.seq = function() {
    if (mori.count(this) > 0) {
      return mori.map((function(cursor) {
        return function(v, i) {
          return toCursor(v, cursor.root, mori.conj1(cursor.path, i));
        };
      })(this), this.value, mori.range());
    }
  };

  mori.extend(IndexedCursor.prototype, {
    IIndexed: {
      nth: IndexedCursor.prototype.nth
    },
    ISeqable: {
      seq: IndexedCursor.prototype.seq
    },
    ICollection: {
      conj: IndexedCursor.prototype.conj
    },
    ISeq: {
      first: IndexedCursor.prototype.first,
      rest: IndexedCursor.prototype.rest
    }
  });

  function MapCursor(value, root, path) {
    SeqableCursor.apply(this, arguments);
  }
  inherits(MapCursor, SeqableCursor);

  MapCursor.prototype.dissoc = function(k) {
    return toCursor(mori.dissoc(this.value, k), this.root, this.path);
  };
  MapCursor.prototype.reduce = function(fn, acc) {
    return mori.reduce_kv(fn, acc, this);
  };
  MapCursor.prototype.seq = function() {
    if (mori.count(this) > 0) {
      return mori.map((function(cursor) {
        return function(val) {
          var k = mori.get(val, 0);
          var v = mori.get(val, 1);
          return mori.vector(k, toCursor(v, cursor.root, mori.conj(cursor.path, k)));
        };
      })(this), this.value);
    }
  };

  mori.extend(MapCursor.prototype, {
    IMap: {
      dissoc: MapCursor.prototype.dissoc
    },
    ISeqable: {
      seq: MapCursor.prototype.seq
    }
  });

  function transact(cursor, keyOrKeys, fn, meta) {
    if (arguments.length === 2) return transact(cursor, vec, keyOrKeys);
    if (typeof keyOrKeys === 'function') return transact(cursor, vec, keyOrKeys, fn);
    return _swap(cursor, keyOrKeys, fn, meta);
  }

  // Swap the value of a cursor, returning the updated cursor, optionally
  // triggering the onChange handler on the root. Shortcuts if nothing has changed.
  function _swap(cursor, keyOrKeys, fn, meta) {
    invariant(isCursor(cursor), 'A cursor must be passed to transact/swap');
    invariant(typeof fn === 'function', 'A function is required.');
    keyOrKeys    = normalizedKeys(keyOrKeys);
    var fullPath = getFullPath(cursor, keyOrKeys);
    var oldValue = get(cursor.root, fullPath);
    var newValue = fn(deref(oldValue));
    __set(cursor, oldValue, newValue, fullPath, emit, meta);
  }

  function set(cursor, keyOrKeys, value, meta) {
    invariant(arguments.length > 1, 'Invalid arity');
    if (arguments.length === 2) return update(cursor, vec, keyOrKeys);
    if (typeof keyOrKeys === 'function') return update(cursor, vec, keyOrKeys, value);
    return _set(cursor, keyOrKeys, value, true, meta);
  }

  // Set the current value on the cursor, optionally triggering the onChange
  // handler on the root.
  function _set(cursor, keyOrKeys, value, emit, meta) {
    invariant(isCursor(cursor), 'A cursor must be passed to update/set');
    keyOrKeys    = normalizedKeys(keyOrKeys);
    var fullPath = getFullPath(cursor, keyOrKeys);
    var oldValue = get(cursor.root, fullPath);
    return __set(cursor, oldValue, value, fullPath, emit, meta);
  }

  function __set(cursor, oldValue, newValue, fullPath, meta) {
    var root    = cursor.root;
    var oldRoot = root.value;
    if (mori.equals(oldValue, newValue)) return cursor;
    if (mori.is_empty(fullPath)) {
      root.value = newValue;
    } else {
      root.value = mori.assoc_in(root.value, fullPath, newValue);
    }
    cursor.root.onChange(fullPath, newValue, oldRoot, root.value, meta);
  }

  function destroy(cursor, meta) {
    var path = getFullPath(cursor);
    invariant(mori.count(path) > 0, 'The root element cannot be destroyed');
    return transact(cursor.root, mori.pop(path), function(val) {
      var item = mori.last(path);
      if (mori.is_indexed(val)) {
        var v = mori.vector();
        switch (item) {
          case 0:
            return mori.into(v, mori.subvec(val, 1));
          case (mori.count(val) - 1):
            return mori.into(v, mori.subvec(val, 0, (mori.count(val) - 1)));
          default:
            return mori.into(v, mori.into(mori.subvec(val, 0, item), mori.subvec(val, item + 1)));
        }
      }
      return mori.dissoc(val, item);
    }, meta);
  }

  function deref(cursor) {
    if (isCursor(cursor)) {
      return cursor.value;
    }
    return cursor;
  }

  // Get the path at a specified key or keys.
  function getFullPath(cursor, keyOrKeys, parent) {
    invariant(isCursor(cursor) || arguments.length === 3, 'Cannot get path of non-cursor');
    if (!isCursor(cursor)) return mori.vector(parent);
    if (arguments.length === 1 || mori.is_empty(keyOrKeys)) return cursor.path;
    if (mori.equals(mori.get_in(cursor.root, cursor.path), cursor)) return mori.into(cursor.path, keyOrKeys);
    var first = mori.first(keyOrKeys);
    return mori.into(getFullPath(get(cursor, first), null, first), mori.rest(keyOrKeys));
  }

  // The "normalized keys" for a cursor.
  function normalizedKeys(keyOrKeys) {
    if (isArray(keyOrKeys)) keyOrKeys = mori.js_to_clj(keyOrKeys);
    if (!mori.is_sequential(keyOrKeys)) keyOrKeys = mori.vector(keyOrKeys);
    return keyOrKeys;
  }

  // Checks whether something "is a" cursor.
  function isCursor(value) {
    return (value instanceof Cursor);
  }

  // Convert a root and a value to a cursor.
  function toCursor(vectorOrMap, root, path) {
    if (isCursor(vectorOrMap) || isPrimitive(vectorOrMap) || mori.is_seq(vectorOrMap)) return vectorOrMap;
    invariant(root instanceof Wrapper, 'toCursor requires the root as the second argument.');
    if (!mori.is_seqable(vectorOrMap)) {
      vectorOrMap = mori.mutable.freeze(coerced(vectorOrMap));
    }
    if (mori.is_indexed(vectorOrMap)) {
      return new IndexedCursor(vectorOrMap, root, path);
    }
    if (mori.is_map(vectorOrMap)) {
      return new MapCursor(vectorOrMap, root, path);
    }
  }

  // TODO: This can be eliminated in favor of js_to_clj()
  // when the IEncodeClojure patch lands.
  function coerced(objOrArr) {
    if (isArray(objOrArr)) {
      return coerceArray(objOrArr);
    } else if (isPlainObject(objOrArr)) {
      return coerceObject(objOrArr);
    }
    throw new Error('Invalid attempt to coerce non array or object.');
  }

  function coerceArray(arr) {
    return mori.reduce(function(acc, val) {
      invariant(isPrimitive(val) || mori.is_seqable(val), 'An array or object may not be coerced to cursor');
      return mori.mutable.conj1(acc, val);
    }, mori.mutable.thaw(mori.vector()), objOrArr);
  }
  function coerceObject(obj) {
    var map = mori.mutable.thaw(mori.hash_map());
    for (var key in obj) {
      var val = obj[key];
      invariant(isPrimitive(val) || mori.is_seqable(val), 'An array or object may not be coerced to cursor');
      mori.mutable.assoc(map, key, val);
    }
    return map;
  }

  var primitives = {
    "number": true,
    "string": true,
    "undefined": true,
    "boolean": true
  };

  function isPrimitive(val) {
    return (primitives[typeof val] || val === null);
  }

  // Simplify throwing errors.
  function invariant(condition, message) {
    if (!condition) {
      var error = new Error(message);
      error.framesToPop = 1;
      throw error;
    }
  }

  // The "Wrapper" serves a similar function to an "atom" in clojurescript,
  // exposing a "swap" method which allows updating the value in place. The
  // root cursor.
  function Wrapper(value, onChange) {
    this.value     = value;
    this.path      = mori.vector();
    this.root      = this;
    this.onChange  = onChange;
  }
  inherits(Wrapper, SeqableCursor);

  // mori.cursor - creates a new cursor object, either wrapping off an root,
  // or taking a function to create an entirely new cursor.
  function cursor(vectorOrMap, onChange) {
    invariant(mori.is_seqable(vectorOrMap), 'A vector or map must be passed to create a root cursor');
    invariant(typeof onChange === "function", 'An onChange handler must be defined for the root cursor');
    return new Wrapper(vectorOrMap, onChange);
  }

  // Get a value from a cursor, guaranteeing that a cursor is returned, preserving 
  // the path if a value isn't retrieved.
  function get(obj, keyOrKeys, fallback) {
    if (arguments.length === 1) return get(obj, []);
    var path = normalizedKeys(keyOrKeys);
    return mori.get_in(obj, path, fallback || null);
  }

  function val(obj, keyOrKeys, fallback) {
    return deref(get.apply(null, arguments));
  }

  function nullUndef(val) {
    return (val === null || val === void 0);
  }

  // Get and return the value for a cursor, passing keyOrKeys and a fallback.
  cursor.transact    = transact;
  cursor.set         = set;
  cursor.destroy     = destroy;
  
  cursor.get         = get;
  cursor.val         = val;
  cursor.deref       = deref;

  // Convert a vector/map to a cursor.
  cursor.toCursor    = function(vectorOrMap, wrapper) {
    invariant((wrapper instanceof Wrapper), 'To convert to toCursor, you must have a wrapper instance.');
    return toCursor(vectorOrMap, wrapper);
  };

  // Utilities
  cursor.isCursor          = isCursor;
  
  // Gets the "full path" for a cursor value.
  cursor.getFullPath = getFullPath;

  // Export constructors
  cursor.Cursor        = Cursor;
  cursor.IndexedCursor = IndexedCursor;
  cursor.SeqableCursor = SeqableCursor;
  cursor.MapCursor     = MapCursor;
  cursor.Wrapper       = Wrapper;

  mori.cursor = cursor;

  return cursor;
};