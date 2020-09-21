const assert = require('assert')

const deepcopy = require('rfdc')()

/**
 * The base schema object
 */
class BaseSchema {
  /**
   * The json schema type
   */
  static TYPE

  /**
   * The max* property name.
   */
  static MAX_PROP_NAME

  /**
   * The min* property name.
   */
  static MIN_PROP_NAME

  /**
   * Constructs a schema object
   */
  constructor () {
    /**
     * Flag to indicate whether an object is a Todea Schema object.
     */
    this.isTodeaSchema = true

    /**
     * For compatibility with fluent-schema. Indicates if an object is a
     * fluent-schema object.
     */
    this.isFluentSchema = true

    /**
     * Stores json schema properties, e.g. type, description, maxLength, etc...
     */
    this.__properties = {}

    /**
     * Indicates whether an object is locked. See {@link lock}.
     */
    this.__isLocked = false
    this.__setProp('type', this.constructor.TYPE)
  }

  /**
   * Locks a Todea Schema object from modifications.
   */
  lock () {
    this.__isLocked = true
    return this
  }

  /**
   * Sets a value in __properties. Throws if object is locked, or property with
   * the same name already exists and override is not allowed.
   * @param {String} name Name of the property
   * @param {*} val The value for the property
   * @param {Object} [options={}]
   * @param {Boolean} [options.allowOverride=false] If true property override
   *   is allowed.
   */
  __setProp (name, val, { allowOverride = false } = {}) {
    assert.ok(!this.__isLocked,
      'Schema is locked. Call copy then further modify the schema')
    assert.ok(allowOverride ||
       !Object.prototype.hasOwnProperty.call(this.__properties, name),
      `Property ${name} is already set.`)
    const shouldOverride = allowOverride &&
      Object.prototype.hasOwnProperty.call(this.__properties, name)
    const ret = shouldOverride ? this.copy() : this
    ret.__properties[name] = val
    return ret
  }

  /**
   * @param {String} name Name of a property
   * @return The value associated with name.
   */
  __getProp (name) {
    return this.__properties[name]
  }

  /**
   * If property with name does not exist, the default value is set.
   * @param {String} name
   * @param {*} defaultValue
   * @return The value associated with name.
   */
  __setDefaultProp (name, defaultValue) {
    if (!Object.prototype.hasOwnProperty.call(this.__properties, name)) {
      this.__setProp(name, defaultValue)
    }
    return this.__getProp(name)
  }

  /**
   * Sets a title.
   * @param {String} t The title of the schema.
   */
  title (t) {
    assert.ok(typeof t === 'string', 'Title must be a string.')
    return this.__setProp('title', t)
  }

  /**
   * Sets a description.
   * @param {String|Array<String>} t The description of the schema. If an array
   *   of strings are passed in, they will be joined by a space to form the
   *   description.
   */
  desc (d) {
    if (Array.isArray(d)) {
      d = d.join(' ')
    }
    assert.ok(typeof d === 'string', 'Description must be a string.')
    return this.__setProp('description', d, { allowOverride: true })
  }

  /**
   * Sets a default value for schema.
   *
   * According to JsonSchema, default value is just metadata and does not
   * serve any validation purpose with in JsonSchema. External tools may
   * choose to use this value to setup defaults, and implementations of
   * JsonSchema validator may choose to validate the type of default values,
   * but it's not required. Since when the default is used to populate the
   * json, there will be something downstream that validates the json and
   * catches issues, we omit schema validation for simplicity.
   *
   * @param {*} d The default value.
   */
  default (d) {
    return this.__setProp('default', d)
  }

  /**
   * Marks a schema as optional. Schemas are required by default.
   */
  optional () {
    return this.__setProp('optional', true)
  }

  /**
   * Convenient getter indicates if the schema is required / not optional.
   * See {@link optional}.
   */
  get required () {
    return !this.__getProp('optional')
  }

  /**
   * Sets schemas readOnly property.
   * @param {Boolean} [r=true] If the schema value should be readOnly.
   */
  readOnly (r = true) {
    return this.__setProp('readOnly', r)
  }

  /**
   * Updates schemas examples.
   * @param {Array<String|Array<String>>} es A list of examples. Each example
   *   may be a string, or a list of strings. In case of a list of strings, the
   *   strings will be joined by a space character and used as one example.
   */
  examples (es) {
    assert.ok(Array.isArray(es), 'Examples must be an array')
    es = es.map(e => {
      return Array.isArray(e) ? e.join(' ') : e
    })
    return this.__setProp('examples', es, { allowOverride: true })
  }

  /**
   * Returns a JSON Schema. It exists for compatibility with fluent-schema.
   */
  valueOf () {
    return this.jsonSchema()
  }

  /**
   * @return JSON Schema without the schema version keyword at the root level.
   */
  __jsonSchema () {
    return this.__properties
  }

  /**
   * @return JSON Schema with the schema version keyword at the root level.
   */
  jsonSchema () {
    const ret = deepcopy(this.__jsonSchema())
    ret.$schema = 'http://json-schema.org/draft-07/schema#'
    return ret
  }

  /**
   * @return A copy of the Todea Schema object. Locked objects become unlocked.
   *
   */
  copy () {
    const ret = new this.constructor()
    ret.__properties = deepcopy(this.__properties)
    return ret
  }

  // max / min support
  /**
   * Validate input to min/max.
   * @param {String} name Property name
   * @param {Integer} val A non-negative integer for min/max.
   */
  __validateRangeProperty (name, val) {
    assert.ok(Number.isInteger(val), `${name} must be an integer`)
    assert.ok(val >= 0, `${name} must be a non-negative number`)
  }

  /**
   * Set a min property depending on schema type.
   * @param {Integer} val A non-negative integer for min/max.
   */
  min (val) {
    const name = this.constructor.MIN_PROP_NAME
    this.__validateRangeProperty(name, val)
    return this.__setProp(name, val)
  }

  /**
   * Set a max property depending on schema type.
   * @param {Integer} val A non-negative integer for min/max.
   */
  max (val) {
    const name = this.constructor.MAX_PROP_NAME
    this.__validateRangeProperty(name, val)
    return this.__setProp(name, val)
  }
}

/**
 * The ObjectSchema class.
 */
class ObjectSchema extends BaseSchema {
  static TYPE = 'object'
  static MAX_PROP_NAME = 'maxProperties'
  static MIN_PROP_NAME = 'minProperties'

  /**
   * Creates an object schema object.
   * @param {Object} [props={}] Keys must be strings, values must be schema
   *   objects. Passing props is the same as calling S.obj().props(props).
   */
  constructor (props = {}) {
    super()
    this.objectSchemas = {}
    this.__setProp('additionalProperties', false)
    this.props(props)
  }

  /**
   * Set an object schema's object property.
   * @param {String} name The name of the property.
   * @param {BaseSchema} schema Any subclass of BaseSchema. Schema gets locked.
   */
  prop (name, schema) {
    assert.ok(!this.__isLocked,
      'Schema is locked. Call copy then further modify the schema')
    assert.ok(typeof name === 'string', 'Property name must be strings.')

    const properties = this.__setDefaultProp('properties', {})
    assert.ok(!Object.prototype.hasOwnProperty.call(properties, name),
      `Property with key ${name} already exists`)

    this.objectSchemas[name] = schema.lock()
    properties[name] = schema.__jsonSchema()
    if (schema.required) {
      this.__setDefaultProp('required', []).push(name)
    }
    return this
  }

  /**
   * A mapping of property names to schemas. Calls this.prop() in a loop.
   * @param {Object} props Keys must be strings, values must be schema
   *   objects.
   */
  props (props) {
    for (const [name, p] of Object.entries(props)) {
      this.prop(name, p)
    }
    return this
  }

  copy () {
    const ret = super.copy()
    Object.assign(ret.objectSchemas, this.objectSchemas)
    return ret
  }
}

/**
 * The ArraySchema class.
 */
class ArraySchema extends BaseSchema {
  static TYPE = 'array'
  static MAX_PROP_NAME = 'maxItems'
  static MIN_PROP_NAME = 'minItems'

  /**
   * Creates an array schema object.
   * @param {BaseSchema} [items] An optional parameter to items(). If provided,
   *   it is the same as calling S.arr().items(items).
   */
  constructor (items) {
    super()
    this.itemsSchema = undefined
    if (items) {
      this.items(items)
    }
  }

  /**
   * Set the schema for items in array
   * @param {BaseSchema} items Any subclass of BaseSchema. Schema gets locked.
   */
  items (items) {
    assert.ok(!this.itemsSchema, 'Items is already set.')
    this.itemsSchema = items.lock()
    this.__setProp('items', items.__jsonSchema())
    return this
  }

  copy () {
    const ret = super.copy()
    ret.itemsSchema = this.itemsSchema
    return ret
  }
}

/**
 * The NumberSchema class.
 */
class NumberSchema extends BaseSchema {
  static TYPE = 'number'
  static MAX_PROP_NAME = 'maximum'
  static MIN_PROP_NAME = 'minimum'

  /**
   * Validate input to min/max.
   * @param {String} name Property name
   * @param {Integer} val A finite number for min/max.
   */
  __validateRangeProperty (name, val) {
    assert.ok(Number.isFinite(val), `${name} must be a number`)
  }
}

/**
 * The IntegerSchema class.
 */
class IntegerSchema extends NumberSchema {
  static TYPE = 'integer'

  /**
   * Validate input to min/max.
   * @param {String} name Property name
   * @param {Integer} val An integer for min/max.
   */
  __validateRangeProperty (name, val) {
    assert.ok(Number.isInteger(val), `${name} must be an integer`)
  }
}

/**
 * The StringSchema class.
 */
class StringSchema extends BaseSchema {
  static TYPE = 'string'
  static MAX_PROP_NAME = 'maxLength'
  static MIN_PROP_NAME = 'minLength'

  /**
   * Set valid values for the string schema.
   * @param {Array<String>} validValues Valid values for the string. There must
   *   be at least 2 valid values.
   */
  enum (validValues) {
    assert.ok(Array.isArray(validValues), 'Enum must be an array.')
    assert.ok(validValues.length >= 2, 'Enum must contain at least 2 values.')
    return this.__setProp('enum', validValues)
  }

  /**
   * A pattern for the string.
   * @param {String|RegExp} pattern The pattern for the string. Can be a string
   *   with regex syntax, or a RegExp object.
   */
  pattern (pattern) {
    if (pattern instanceof RegExp) {
      pattern = pattern.source
    }
    assert.ok(typeof pattern === 'string', 'Pattern must be a string')
    return this.__setProp('pattern', pattern)
  }
}

/**
 * The BooleanSchema class.
 */
class BooleanSchema extends BaseSchema {
  static TYPE = 'boolean'
}

/**
 * The MapSchema class.
 */
class MapSchema extends ArraySchema {
  static TYPE = 'array'

  constructor () {
    super()
    this.objectSchema = new ObjectSchema().min(2).max(2)
  }

  items (i) {
    throw new Error('Map does not support Items')
  }

  /**
   * Set a key schema for the map.
   * @param {StringSchema} key A StringSchema object for keys.
   */
  key (key) {
    assert.ok(key.constructor.TYPE === 'string', 'Key must be strings')
    assert.ok(key.required, 'key must be required')
    this.objectSchema.prop('key', key)
    return this
  }

  /**
   * Set a value schema for the map.
   * @param {BaseSchema} value Any subclass of BaseSchema for the values of map
   */
  value (value) {
    assert.ok(value.required, 'value must be required')
    this.objectSchema.prop('value', value)
    return this
  }

  __jsonSchema () {
    assert.ok((this.objectSchema.__getProp('properties') || {}).value,
      'Must have a value schema')
    if (!this.objectSchema.__getProp('properties').key) {
      this.objectSchema.prop('key', S.str)
    }
    if (!this.__getProp('items')) {
      super.items(this.objectSchema) // items on this is disabled.
    }
    return super.__jsonSchema()
  }

  copy () {
    const ret = super.copy()
    ret.objectSchema = this.objectSchema.copy()
    return ret
  }
}

/**
 * The S object to be exported.
 * Noteworthily, it is safe to deprecate certain schema types simply by
 * deleting the corresponding accessor.
 */
class S {
  /**
   * @param {Object} object See {@link ObjectSchema#constructor}
   * @return A new ObjectSchema object.
   */
  static obj (object) { return new ObjectSchema(object) }

  /**
   * @param {BaseSchema} schema See {@link ArraySchema#constructor}
   * @return A new ArraySchema object.
   */
  static arr (schema) { return new ArraySchema(schema) }

  /**
   * Get a new NumberSchema object.
   */
  static get num () { return new NumberSchema() }

  /**
   * Get a new IntegerSchema object.
   */
  static get int () { return new IntegerSchema() }

  /**
   * Get a new StringSchema object.
   */
  static get str () { return new StringSchema() }

  /**
   * Get a new BooleanSchema object.
   */
  static get bool () { return new BooleanSchema() }

  /**
   * Get a new MapSchema object.
   */
  static get map () { return new MapSchema() }

  /**
   * Lock all schemas in a dictionary (in-place).
   * @param {Object<Schema>} schemas a map of schema values
   * @returns the input map of schema values
   */
  static lock (schemas) {
    Object.values(schemas).forEach(x => x.lock())
    return schemas
  }

  /**
   * Common schemas.
   */
  static SCHEMAS = S.lock({
    UUID: S.str.desc('An UUID. It is normally generated by calling uuidv4().')
      .pattern(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/),
    STR_ANDU: S.str.desc('Only hyphens, underscores, letters and numbers are permitted.')
      .pattern(/^[-_a-zA-Z0-9]+$/),
    // oversimplified, quick regex to check that a string looks like an email
    STR_EMAIL: S.str.pattern(/^.+@.+$/).desc('an e-mail address').lock(),
    STR_TODEA_BASE32: S.str.desc('Only select digits and uppercase ASCII characters')
      .pattern(/^[ABCDEFGHJLMNPQRSTUVWXYZ023456789]+$/)
  })
}

module.exports = S
