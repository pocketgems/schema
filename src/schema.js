const assert = require('assert')

let ajv // only defined if needed
const deepcopy = require('rfdc')() // cspell:disable-line

/**
 * Any non alphanumerical characters are stripped, the immediate next character
 * is capitalized.
 * @param {String} str
 * @return A string ID, AKA an upper camel case string.
 */
function toStringID (str) {
  if (!str || str.length === 0) {
    return str
  }
  return str.split(/[^a-zA-Z0-9]/).map(s => {
    return s.replace(/^./, s[0].toUpperCase())
  }).join('')
}

/**
 * Thrown if a compiled schema validator is asked to validate an invalid value.
 */
class ValidationError extends Error {
  /**
   * @param {string} name a user-provided name describing the schema
   * @param {*} badValue the value which did not validate
   * @param {object} errors how badValue failed to conform to the schema
   */
  constructor (name, badValue, errors) {
    super(`Validation Error: ${name}`)
    this.badValue = badValue
    this.validationErrors = errors
    if (process.env.NODE_ENV === 'localhost') {
      console.error(errors)
    }
  }
}

/**
 * The base schema object
 */
class BaseSchema {
  /**
   * The json schema type
   */
  static JSON_SCHEMA_TYPE

  /**
   * The C2J schema type
   */
  static C2J_SCHEMA_TYPE

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
        ajv = new (require('ajv'))({ allErrors: true })
      }
      compiler = ajv
    }
    this.lock()
    const jsonSchema = this.jsonSchema()
    const validate = compiler.compile(this.jsonSchema())
    const validateOrDie = v => {
      if (!validate(v)) {
        throw new ValidationError(name, v, validate.errors)
      }
    }
    if (returnSchemaToo) {
      return { jsonSchema, validateOrDie }
    }
    return validateOrDie
  }

  /**
   * See {@link compile}.
   * @returns {Object} contains jsonSchema and validateOrDie
   */
  getValidatorAndJSONSchema (name, compiler) {
    return this.compile(name, compiler, true)
  }
  /**
   * @typedef {Object} C2JSchemaReturnValue
   * @property {String} retName The actual name used for the shape schema
   * @property {Object} retShape The shape schema
   * @property {String} retDoc The documentation / description for the shape
   *   schema
   */

  /**
   * Generates C2J shape schema. Derives a name for the generated shape schema
   * based on the 'title' property then fallback to defaultName. Nested schema
   * uses the current shape schema name as prefix / scope. Adds the current
   * shape schema to the container if requested. Nested shape schemas are
   * always added to the container.
   *
   * @param {Object} param
   * @param {Object} [param.defaultName] A tentative name for the shape, if
   *   it is added to the container. Also a prefix for nested shapes
   * @param {String} [param.addToContainer=true] If the shape schema should be
   *   added to the container. Nested shapes will always be added to the
   *   container.
   * @param {ContainerObject} param.container A container object that
   *   implements addShape(name, shapeSchema)
   * @param {String} [param.location] The location for the schema, e.g. header
   *   queryString, etc...
   * @return {C2JSchemaReturnValue} Metadata of the shape along with the shape.
   */
  c2jShape ({ defaultName = '', container, addToContainer = true }) {
    const ret = {
      type: this.constructor.C2J_SCHEMA_TYPE
    }
    const max = this.__getProp(this.constructor.MAX_PROP_NAME)
    if (max !== undefined) {
      ret.max = max
    }
    const min = this.__getProp(this.constructor.MIN_PROP_NAME)
    if (min !== undefined) {
      ret.min = min
    }

    const name = toStringID(this.__getProp('title') || defaultName)
    if (addToContainer) {
      container.addShape(name, ret)
    }
    return {
      retName: name,
      retShape: ret,
      retDoc: this.__getProp('description')
    }
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
  static JSON_SCHEMA_TYPE = 'object'
  static C2J_SCHEMA_TYPE = 'structure'
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

  __jsonSchema () {
    const ret = super.__jsonSchema()
    if (Object.keys(this.objectSchemas).length === 0) {
      // Allow any key if no key is defined.
      ret.additionalProperties = true
    }
    return ret
  }

  c2jShape ({
    addToContainer = true,
    container,
    defaultName,
    location
  }) {
    const { retName, retShape, retDoc } = super.c2jShape({
      addToContainer: false, // Don't add yet, members and required not setup.
      container,
      defaultName
    })
    const members = {}
    const required = []
    for (const [name, p] of Object.entries(this.objectSchemas)) {
      const camelName = toStringID(name)
      const ret = p.c2jShape({
        defaultName: retName + camelName,
        container
      })
      const shapeName = ret.retName
      const shapeDoc = ret.retDoc
      if (p.required) {
        required.push(camelName)
      }
      const shapeSpec = {
        shape: shapeName,
        locationName: name
      }
      if (location) {
        shapeSpec.location = location
      }
      if (shapeDoc) {
        shapeSpec.documentation = shapeDoc
      }
      members[camelName] = shapeSpec
    }

    retShape.members = members
    if (required.length !== 0) {
      retShape.required = required
    }

    if (addToContainer) {
      container.addShape(retName, retShape)
    }
    return { retName, retShape, retDoc }
  }
}

/**
 * The ArraySchema class.
 */
class ArraySchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'array'
  static C2J_SCHEMA_TYPE = 'list'
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

  c2jShape ({ defaultName, addToContainer = true, container }) {
    const { retName, retShape, retDoc } = super.c2jShape({
      defaultName: defaultName + 'List',
      container,
      addToContainer: false // Don't add yet, since member is not setup.
    })

    const ret = this.itemsSchema.c2jShape({
      defaultName, container
    })
    const shapeName = ret.retName
    const shapeDoc = ret.retDoc
    const shapeSpec = { shape: shapeName }
    if (retDoc) {
      shapeSpec.documentation = shapeDoc
    }

    retShape.member = shapeSpec
    if (addToContainer) {
      container.addShape(retName, retShape)
    }
    return { retName, retShape, retDoc }
  }
}

/**
 * The NumberSchema class.
 */
class NumberSchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'number'
  static C2J_SCHEMA_TYPE = 'double'
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
  static JSON_SCHEMA_TYPE = 'integer'
  static C2J_SCHEMA_TYPE = 'integer'

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
  static JSON_SCHEMA_TYPE = 'string'
  static C2J_SCHEMA_TYPE = 'string'
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

  c2jShape ({
    addToContainer = true,
    container,
    defaultName
  }) {
    const ret = super.c2jShape({
      addToContainer: false,
      container,
      defaultName
    })
    for (const prop of ['pattern', 'enum']) {
      const val = this.__getProp(prop)
      if (val) {
        ret.retShape[prop] = val
      }
    }
    if (addToContainer) {
      container.addShape(ret.retName, ret.retShape)
    }
    return ret
  }
}

/**
 * The BooleanSchema class.
 */
class BooleanSchema extends BaseSchema {
  static JSON_SCHEMA_TYPE = 'boolean'
  static C2J_SCHEMA_TYPE = 'boolean'
}

/**
 * The MapSchema class.
 */
class MapSchema extends ArraySchema {
  static JSON_SCHEMA_TYPE = 'array'
  static C2J_SCHEMA_TYPE = 'map'

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
    assert.ok(key.constructor.JSON_SCHEMA_TYPE === 'string', 'Key must be strings')
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

  __finalizeSchema () {
    assert.ok((this.objectSchema.__getProp('properties') || {}).value,
      'Must have a value schema')
    if (!this.objectSchema.__getProp('properties').key) {
      this.objectSchema.prop('key', S.str)
    }
    if (!this.__getProp('items')) {
      super.items(this.objectSchema) // items on this is disabled.
    }
  }

  __jsonSchema () {
    this.__finalizeSchema()
    return super.__jsonSchema()
  }

  copy () {
    const ret = super.copy()
    ret.objectSchema = this.objectSchema.copy()
    return ret
  }

  c2jShape ({
    addToContainer = true,
    container,
    defaultName
  }) {
    this.__finalizeSchema()

    // To C2J MapSchema is just map, no Array of Objects. Here we bypass super
    // and go directly to BaseSchema for common functionalities.
    const { retName, retShape, retDoc } = BaseSchema.prototype.c2jShape.call(
      this,
      {
        defaultName: defaultName,
        container,
        addToContainer: false
      }
    )

    for (const propName of ['key', 'value']) {
      const propDefaultName = defaultName + toStringID(propName)
      const ret = this.objectSchema.objectSchemas[propName]
        .c2jShape({
          defaultName: propDefaultName,
          container
        })
      const shapeName = ret.retName
      const shapeDoc = ret.retDoc
      const shapeSpec = {
        shape: shapeName,
        locationName: propName
      }
      if (shapeDoc) {
        shapeSpec.documentation = shapeDoc
      }
      retShape[propName] = shapeSpec
    }
    if (addToContainer) {
      container.addShape(retName, retShape)
    }
    return { retName, retShape, retDoc }
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
    // cspell: disable-next-line
    STR_TODEA_BASE32: S.str.pattern(/^[ABCDEFGHJLMNPQRSTUVWXYZ023456789]+$/)
      .desc('Only select digits and uppercase ASCII characters')
  })

  /** Thrown if validation fails. */
  static ValidationError = ValidationError
}

// istanbul ignore else
if (process.env.NODE_ENV === 'localhost') {
  S.__private = {
    toStringID
  }
}

module.exports = S
