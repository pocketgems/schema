const assert = require('assert')

let ajv // only defined if needed
const deepcopy = require('rfdc')() // cspell:disable-line

/**
 * Thrown if a compiled schema validator is asked to validate an invalid value.
 */
class ValidationError extends Error {
  /**
   * @param {string} name a user-provided name describing the schema
   * @param {*} badValue the value which did not validate
   * @param {Object} errors how badValue failed to conform to the schema
   * @param {Object} expectedSchema The JSON schema used in schema validation
   */
  constructor (name, badValue, errors, expectedSchema) {
    super(`Validation Error: ${name}`)
    this.badValue = badValue
    this.validationErrors = errors
    this.expectedSchema = expectedSchema
    // istanbul ignore next
    if (['localhost', 'webpack'].includes(process.env.NODE_ENV)) {
      console.error(JSON.stringify(errors, null, 2))
    }
  }
}

const INT32_MAX = Math.pow(2, 31) - 1
const INT32_MIN = -Math.pow(2, 31)
const TIMESTAMP_MIN = '2000-01-01T00:00:00Z'
const TIMESTAMP_MAX = '9999-01-01T00:00:00Z'
const EPOCH_IN_MILLISECONDS_MIN = new Date(TIMESTAMP_MIN).getTime()
const EPOCH_IN_MILLISECONDS_MAX = new Date(TIMESTAMP_MAX).getTime()
const EPOCH_IN_SECONDS_MIN = EPOCH_IN_MILLISECONDS_MIN / 1000
const EPOCH_IN_SECONDS_MAX = EPOCH_IN_MILLISECONDS_MAX / 1000

// javascript is limited in how it can represent >53 bit numbers
// so 2^62 is naturally the best we can do
const INT64_MAX = Math.pow(2, 62)
const INT64_MIN = -Math.pow(2, 62)

/**
 * The base schema object
 */
class BaseSchema {
  /**
   * The json schema type
   */
  static JSON_SCHEMA_TYPE

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
    this.__isOptional = false
    this.__setProp('type', this.constructor.JSON_SCHEMA_TYPE)
  }

  /**
   * Locks a Todea Schema object from modifications.
   */
  lock () {
    this.__isLocked = true
    return this
  }

  /**
   * Sets a value in __properties. Throws if object is locked (unless the
   * property is allowed to be overridden), or property with
   * the same name already exists and override is not allowed.
   * @param {String} name Name of the property
   * @param {*} val The value for the property
   * @param {Object} [options={}]
   * @param {Boolean} [options.allowOverride=false] If true property override
   *   is allowed.
   */
  __setProp (name, val, { allowOverride = false } = {}) {
    assert.ok(!this.__isLocked || allowOverride,
      'Schema is locked. Call copy then further modify the schema')
    assert.ok(allowOverride ||
       !Object.prototype.hasOwnProperty.call(this.__properties, name),
      `Property ${name} is already set.`)
    const shouldCopy = this.__isLocked || (allowOverride &&
      Object.prototype.hasOwnProperty.call(this.__properties, name))
    const ret = shouldCopy ? this.copy() : this
    ret.__properties[name] = val
    if (this.__isLocked) {
      ret.lock()
    }
    return ret
  }

  /**
   * @param {String} name Name of a property
   * @return The value associated with name.
   */
  getProp (name) {
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
    return this.getProp(name)
  }

  /**
   * Sets a title.
   * @param {String} t The title of the schema.
   */
  title (t) {
    assert.ok(typeof t === 'string', 'Title must be a string.')
    return this.__setProp('title', t, { allowOverride: true })
  }

  /**
   * Sets a description.
   * @param {String|Array<String>} t The description of the schema. If an array
   *   of strings are passed in, they will be joined by a space to form the
   *   description.
   */
  desc (d) {
    assert.ok(typeof d === 'string', 'Description must be a string.')
    d = d.trim().replace(/\n/g, ' ')
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
    assert(d !== undefined, 'Default value must be defined')
    Object.freeze(d)
    return this.__setProp('default', d)
  }

  getDefault () {
    return this.properties().default
  }

  hasDefault () {
    return Object.prototype.hasOwnProperty.call(this.properties(), 'default')
  }

  /**
   * Marks a schema as optional. Schemas are required by default.
   */
  optional () {
    assert(!this.__isLocked, 'Schema is locked.')
    this.__isOptional = true
    return this
  }

  /**
   * Convenient getter indicates if the schema is required / not optional.
   * See {@link optional}.
   */
  get required () {
    return !this.__isOptional
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
   * The visitable in a visitor pattern. Used for exporting schema.
   * @param {Exporter} visitor a schema exporter. @see JSONSchemaExporter
   */
  // istanbul ignore next
  export (visitor) {
    throw new Error('Subclass must override')
  }

  properties () {
    return this.__properties
  }

  /**
   * @return JSON Schema with the schema version keyword at the root level.
   */
  jsonSchema () {
    const exporter = new JSONSchemaExporter()
    return exporter.export(this)
  }

  /**
   * Returns a validator function which throws ValidationError if the value it
   * is asked to validate does not match the schema.
   *
   * Locks the current schema.
   *
   * @param {string} name the name of this schema (to distinguish errors)
   * @param {*} [compiler] the ajv or equivalent JSON schema compiler to use
   * @param {returnSchemaToo} [returnSchemaToo] whether to return jsonSchema as
   *   well as the validator
   * @returns {Function} call on a value to validate it; throws on error
   */
  compile (name, compiler, returnSchemaToo) {
    assert.ok(name, 'name is required')
    if (!compiler) {
      if (!ajv) {
        ajv = new (require('ajv'))({
          allErrors: true,
          useDefaults: true,
          strictSchema: false
        })
      }
      compiler = ajv
    }
    this.lock()
    const jsonSchema = this.jsonSchema()
    const validate = compiler.compile(jsonSchema)
    const assertValid = v => {
      if (!validate(v)) {
        throw new ValidationError(name, v, validate.errors, jsonSchema)
      }
    }
    if (returnSchemaToo) {
      return { jsonSchema, assertValid }
    }
    return assertValid
  }

  /**
   * See {@link compile}.
   * @returns {Object} contains jsonSchema and assertValid
   */
  getValidatorAndJSONSchema (name, compiler) {
    return this.compile(name, compiler, true)
  }

  /**
   * @return A copy of the Todea Schema object. Locked objects become unlocked.
   *
   */
  copy () {
    const ret = new this.constructor()
    ret.__properties = deepcopy(this.__properties)
    ret.__isOptional = this.__isOptional
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
    const max = this.getProp(this.constructor.MAX_PROP_NAME)
    assert.ok(max === undefined || max >= val, 'min must be less than max')
    return this.__setProp(name, val)
  }

  /**
   * Set a max property depending on schema type.
   * @param {Integer} val A non-negative integer for min/max.
   */
  max (val) {
    const name = this.constructor.MAX_PROP_NAME
    this.__validateRangeProperty(name, val)
    const min = this.getProp(this.constructor.MIN_PROP_NAME)
    assert.ok(min === undefined || min <= val, 'max must be more than min')
    return this.__setProp(name, val)
  }
}

/**
 * The ObjectSchema class.
 */
class ObjectSchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'object'
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
    this.patternSchemas = {}
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
    assert.ok(schema !== undefined, `Property ${name} must define a schema`)

    this.objectSchemas[name] = schema.lock()
    properties[name] = schema.properties()
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

  /**
   * A mapping of propertyProperties to schemas.
   * @param {Object} props Keys must be regex, values must be schema
   */
  patternProps (props) {
    for (const [name, schema] of Object.entries(props)) {
      const properties = this.__setDefaultProp('patternProperties', {})
      assert.ok(!Object.prototype.hasOwnProperty.call(properties, name),
        `Pattern ${name} already exists`)
      const anchoredName = getAnchoredPattern(name)
      this.patternSchemas[anchoredName] = schema.lock()
      properties[anchoredName] = schema.properties()
    }
    return this
  }

  copy () {
    const ret = super.copy()
    Object.assign(ret.objectSchemas, this.objectSchemas)
    Object.assign(ret.patternSchemas, this.patternSchemas)
    return ret
  }

  properties () {
    const ret = super.properties()
    // Allow any key if no key is defined.
    const hasProperty = Object.keys(this.objectSchemas).length > 0 ||
      Object.keys(this.patternSchemas).length > 0
    const hasAdditionalProperties = !!this.additionalProperties // make it bool
    ret.additionalProperties = !hasProperty || hasAdditionalProperties
    return ret
  }

  export (visitor) {
    return visitor.exportObject(this)
  }
}

/**
 * The ArraySchema class.
 */
class ArraySchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'array'
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
    this.__setProp('items', items.properties())
    return this
  }

  copy () {
    const ret = super.copy()
    ret.itemsSchema = this.itemsSchema
    return ret
  }

  export (visitor) {
    return visitor.exportArray(this)
  }
}

/**
 * The NumberSchema class.
 */
class NumberSchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'number'
  static MAX_PROP_NAME = 'maximum'
  static MIN_PROP_NAME = 'minimum'

  constructor () {
    super()
    this.__isFloat = false
  }

  /**
   * Validate input to min/max.
   * @param {String} name Property name
   * @param {Integer} val A finite number for min/max.
   */
  __validateRangeProperty (name, val) {
    assert.ok(Number.isFinite(val), `${name} must be a number`)
  }

  asFloat () {
    assert(!this.__isLocked, 'Schema is locked')
    this.__isFloat = true
    return this
  }

  get isFloat () {
    return this.__isFloat
  }

  export (visitor) {
    return visitor.exportNumber(this)
  }

  copy () {
    const ret = super.copy()
    ret.__isFloat = this.__isFloat
    return ret
  }
}

/**
 * The IntegerSchema class.
 */
class IntegerSchema extends NumberSchema {
  static JSON_SCHEMA_TYPE = 'integer'

  /**
   * Validate input to min/max.
   * @param {String} name Property name
   * @param {Integer} val An integer for min/max.
   */
  __validateRangeProperty (name, val) {
    assert.ok(Number.isInteger(val), `${name} must be an integer`)
  }

  /**
   * sets limit on how large max or min can be.
   * Validates current min/max to ensure they work correctly
   */
  __setSafeRangeLimit (val) {
    const max = this.getProp(this.constructor.MAX_PROP_NAME)
    if (max === undefined) {
      this.max(val)
    } else {
      assert.ok(max <= val, `max cannot exceed ${val}`)
    }
    const min = this.getProp(this.constructor.MIN_PROP_NAME)
    if (min === undefined) {
      this.min(-val)
    } else {
      assert.ok(min >= -val, `min must be larger than ${-val}`)
    }
    return this
  }

  /**
   * applies range for Int32 values
   */
  asInt32 () {
    return this.__setSafeRangeLimit(INT32_MAX)
  }

  /**
   * applies range for int64 values
   */
  asInt64 () {
    return this.__setSafeRangeLimit(INT64_MAX)
  }

  asFloat = undefined

  export (visitor) {
    return visitor.exportInteger(this)
  }
}

/**
 * The StringSchema class.
 */
class StringSchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'string'
  static MAX_PROP_NAME = 'maxLength'
  static MIN_PROP_NAME = 'minLength'

  /**
   * Set valid values for the string schema.
   * @param {Array<String>} validValues Valid values for the string. There must
   *   be at least 2 valid values.
   */
  enum (validValues) {
    const values = Array.isArray(validValues) ? validValues : [...arguments]
    assert(values.length >= 1, 'Enum must contain at least 1 value.')
    return this.__setProp('enum', values)
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
    assert(typeof pattern === 'string', 'Pattern must be a string')
    const anchoredPattern = getAnchoredPattern(pattern)
    return this.__setProp('pattern', anchoredPattern)
  }

  export (visitor) {
    return visitor.exportString(this)
  }
}

/**
 * The BooleanSchema class.
 */
class BooleanSchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'boolean'

  export (visitor) {
    return visitor.exportBoolean(this)
  }
}

/**
 * The MapSchema class.
 */
class MapSchema extends ObjectSchema {
  constructor () {
    super()
    // deprecate obj methods
    this.prop = undefined
    this.props = undefined
    this.patternProps = undefined

    this.finalized = false
    this.keySchema = undefined
    this.valueSchema = undefined
  }

  /**
   * Set a key pattern for the map.
   * @param {String} keyPattern A pattern for keys
   */
  keyPattern (pattern) {
    assert(!this.keySchema, 'key pattern already set')
    this.keySchema = S.str.pattern(pattern).lock()
    this.__tryFinalizeSchema()
    return this
  }

  /**
   * Set a value schema for the map.
   * @param {BaseSchema} value Any subclass of BaseSchema for the values of map
   */
  value (value) {
    assert(!this.valueSchema, 'value schema already set')
    assert(value.required, 'value must be required')
    this.valueSchema = value.lock()
    this.__tryFinalizeSchema()
    return this
  }

  lock () {
    this.__finalizeSchema()
    return super.lock()
  }

  __finalizeSchema () {
    assert(this.valueSchema, 'Must have a value schema')
    if (!this.keySchema) {
      this.keySchema = S.str
    }
    this.__tryFinalizeSchema()
  }

  __tryFinalizeSchema () {
    if (this.keySchema && this.valueSchema && !this.finalized) {
      this.finalized = true
      super.patternProps({
        [this.keySchema?.getProp('pattern') ?? '.*']: this.valueSchema
      })
    }
  }

  export (visitor) {
    this.__finalizeSchema()
    return visitor.exportMap(this)
  }

  copy () {
    const ret = super.copy()
    ret.finalized = this.finalized
    ret.keySchema = this.keySchema.copy()
    ret.valueSchema = this.valueSchema.copy()
    return ret
  }
}

class MediaSchema extends StringSchema {
  type (t) {
    this.__setProp('contentMediaType', t)
    return this
  }

  encoding (e) {
    assert(['binary', 'base64', 'utf-8'].includes(e),
      'Encoding must be binary, base64 or utf-8')
    this.__setProp('contentEncoding', e)
    return this
  }

  export (visitor) {
    return visitor.exportMedia(this)
  }
}

class JSONSchemaExporter {
  constructor () {
    const methods = [
      'exportString',
      'exportInteger',
      'exportNumber',
      'exportObject',
      'exportArray',
      'exportBoolean',
      'exportMap',
      'exportMedia'
    ]

    for (const method of methods) {
      Object.defineProperty(this, method, {
        get: () => {
          return (schema) => {
            return schema.properties()
          }
        }
      })
    }
  }

  export (schema) {
    const ret = deepcopy(schema.export(this))
    ret.$schema = 'http://json-schema.org/draft-07/schema#'
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
  static get double () { return new NumberSchema() }

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
   * Get a new MediaSchema object.
   */
  static get media () { return new MediaSchema() }
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
   * Sets all schemas as optional (in-place).
   * @param {Object<Schema>} schemas a map of schema values
   * @returns the input map of schema values
   */
  static optional (schemas) {
    Object.values(schemas).forEach(x => x.optional())
    return schemas
  }

  static PATTERN = {
    UUID_PATTERN: /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/
  }

  /**
   * Common schemas.
   */
  static SCHEMAS = S.lock({
    UUID: S.str.desc('An UUID. It is normally generated by calling uuidv4().')
      .pattern(S.PATTERN.UUID_PATTERN),
    STR_ANDU: S.str.desc('Only hyphens, underscores, letters and numbers are permitted.')
      .pattern(/^[-_a-zA-Z0-9]+$/),
    // oversimplified, quick regex to check that a string looks like an email
    STR_EMAIL: S.str.pattern(/^[^A-Z ]+@.+$/)
      .desc('an e-mail address (lowercase only)').lock(),
    TIMESTAMP: S.str
      .pattern(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d{3}Z/)
      .desc(`An UTC timestamp with millisecond precision, for example,
        2021-02-15T20:15:59.321Z`),
    TIMESTAMP_WITH_TZ: S.str
      .pattern(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d(\.\d*)?([+-][0-2]\d:[0-5]\d|Z)/)
      .desc(`Timestamp with time zone and optional millisecond precision,
        for example,
        2021-02-15T20:15:59Z,
        2022-09-15T16:48:28.9097226Z,
        2021-02-15T11:55:20-05:00,
        2021-02-15T11:55:20.9097226+08:00`),
    EPOCH_IN_SECONDS: S.int.min(EPOCH_IN_SECONDS_MIN)
      .max(EPOCH_IN_SECONDS_MAX).desc(`Unix epoch time format in seconds from
        ${TIMESTAMP_MIN} to ${TIMESTAMP_MAX}.`),
    EPOCH_IN_MILLISECONDS: S.int.min(EPOCH_IN_MILLISECONDS_MIN)
      .max(EPOCH_IN_MILLISECONDS_MAX).desc(`Unix epoch time format in
        milliseconds from ${TIMESTAMP_MIN} to ${TIMESTAMP_MAX}.`).asInt64()
  })

  /** Thrown if validation fails. */
  static ValidationError = ValidationError

  static INT32_MAX = INT32_MAX

  static INT32_MIN = INT32_MIN

  static INT64_MAX = INT64_MAX

  static INT64_MIN = INT64_MIN
}

function getAnchoredPattern (pattern) {
  let anchoredName = pattern
  if (pattern[0] !== '^') {
    anchoredName = '^' + pattern
  }
  if (pattern[pattern.length - 1] !== '$') {
    anchoredName += '$'
  }
  return anchoredName
}

module.exports = S
