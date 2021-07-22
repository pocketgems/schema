const assert = require('assert')

const ajv = new (require('ajv'))({ allErrors: true })
const FS = require('fluent-schema')

const S = require('../src/schema')

const { BaseTest, runTests } = require('./base-unit-test')

class ProxySchema {
  constructor (fs, s) {
    assert.ok(s !== undefined, 'S must be defined')
    this.fs = fs
    this.s = s
    const props = [
      'enum', 'pattern', 'title', 'id', 'examples'
    ]
    for (const prop of props) {
      this[prop] = (...args) => {
        let temp = this.fs[prop](...args)
        if (prop === 'object') {
          temp = temp.additionalProperties(false)
        }
        return new ProxySchema(
          temp,
          this.s[prop](...args)
        )
      }
    }

    const classMapping = {
      array: 'arr',
      object: 'obj',
      string: 'str',
      integer: 'int',
      number: 'double',
      boolean: 'bool',
      media: 'media'
    }
    for (const [left, right] of Object.entries(classMapping)) {
      this[left] = (...args) => {
        let tempA = (
          left === 'media'
            ? this.fs.string
            : this.fs[left]
        )(...args)
        if (left === 'object') {
          tempA = tempA.additionalProperties(false)
        }
        let tempB = this.s[right]
        if (['object', 'array'].includes(left)) {
          tempB = tempB()
        }
        return new ProxySchema(
          tempA,
          tempB
        )
      }
    }
    const propMapping = {
      minInteger: 'min',
      maxInteger: 'max',
      minItems: 'min',
      maxItems: 'max',
      minProperties: 'min',
      maxProperties: 'max',
      minLength: 'min',
      maxLength: 'max',
      minimum: 'min',
      maximum: 'max',
      description: 'desc',
      contentEncoding: 'encoding',
      contentMediaType: 'type'
    }
    for (const [left, right] of Object.entries(propMapping)) {
      this[left] = (...args) => {
        return new ProxySchema(
          this.fs[left](...args),
          this.s[right](...args)
        )
      }
    }
  }

  prop (name, p) {
    return new ProxySchema(
      this.fs.prop(name, p.fs),
      this.s.prop(name, p.s)
    )
  }

  items (p) {
    return new ProxySchema(
      this.fs.items(p.fs),
      this.s.items(p.s)
    )
  }

  patternProp (name, value) {
    name = name.toString()
    return new ProxySchema(
      this.fs.patternProperties({ [name]: value.fs }),
      this.s.patternProps({ [name]: value.s })
    )
  }

  verify () {
    expect(this.fs.valueOf()).toStrictEqual(this.s.jsonSchema())
  }
}

const P = new ProxySchema(FS, S)

class FeatureParityTest extends BaseTest {
  testLock () {
    // Fluent schema constantly makes copies of objects to allow diverging
    // schemas. Coping and allocating new object is slow, so we don't do it for
    // every chained method call -- only when a property is overwritten by
    // another value. In addition, Todea's schema can be locked to prevent
    // further modification, then to further modify the schema users need to
    // explicitly unlock-by-copying.
    const str = P.string()
    P.object().prop('a', str).verify()
    expect(() => {
      P.object().prop('b', str.minLength(1)).verify()
    }).toThrow(/is locked/)

    const obj = S.obj().lock()
    expect(() => {
      obj.min(1)
    }).toThrow(/is locked/)

    expect(() => {
      obj.copy().min(1)
    }).not.toThrow()
  }

  testAutoLockAfterAutoCopy () {
    const str = S.str
    str.lock()
    const str2 = str.desc('x')
    expect(str2.__isLocked).toBe(true)
    expect(() => str2.min(1)).toThrow(/is locked/)
  }

  testObjectPropOverwrite () {
    // Overriding an existing object property is caught
    const o = S.obj({ a: S.int })
    o.prop('b', S.int)

    expect(() => {
      // Setting a property with the same schema fails
      o.prop('a', S.int)
    }).toThrow('Property with key a already exists')

    expect(() => {
      // Setting a property with a different schema fails
      o.prop('a', S.str)
    }).toThrow('Property with key a already exists')

    expect(() => {
      // Props API behaves the same.
      o.props({ a: S.int })
    }).toThrow('Property with key a already exists')
  }

  testLockObject () {
    // May not add more props to a locked object
    const o = S.obj({ a: S.int }).lock()
    expect(() => {
      o.prop('b', S.int)
    }).toThrow(/is locked/)
    expect(() => {
      o.props({ b: S.int })
    }).toThrow(/is locked/)
  }

  testObject () {
    P.object()
      .examples(['aaa', 'bbb'])
      .minProperties(1)
      .maxProperties(2)
      .prop('somename', P.string())
      .prop('a', P.array().items(P.string()))
      .verify()

    P.object()
      .title('abc')
      .examples(['aaa', 'bbb'])
      .description('1123')
      .prop('a', P.string())
      .verify()
  }

  testObjectPattern () {
    P.object()
      .patternProp(/abc/, P.string())
      .verify()
  }

  testArray () {
    P.array().verify()
    P.array().minItems(1).maxItems(2).verify()
    P.array().items(P.object().prop('a', P.string()))
      .examples(['aaa', 'bbb']).verify()
    P.array().title('abc').description('1123').verify()
  }

  testString () {
    P.string().verify()
    P.string().minLength(1).maxLength(2).verify()
    P.string().pattern('1231').verify()
    P.string().enum(['a', 'b']).examples(['aaa', 'bbb']).verify()
    P.string().title('abc').description('1123').verify()
  }

  testNumber () {
    P.number().verify()
    P.number().minimum(1).maximum(2).verify()
    P.number().title('abc').examples(['aaa', 'bbb'])
      .description('1123').verify()
  }

  testInteger () {
    P.integer().verify()
    P.integer().minimum(1).maximum(2).verify()
    P.integer().title('abc').examples(['aaa', 'bbb'])
      .description('1123').verify()
  }

  testBoolean () {
    P.boolean().verify()
    P.boolean().title('abc').description('1123').verify()
  }

  testMedia () {
    P.media().verify()
    P.media().contentEncoding('base64').contentMediaType('application/zip')
      .verify()
  }
}

class ValidationTest extends BaseTest {
  testExamples () {
    expect(() => {
      S.obj().examples('')
    }).toThrow('Examples must be an array')
  }

  testObject () {
    expect(() => {
      S.obj().min(0.2)
    }).toThrow(/must be an integer/)

    expect(() => {
      S.obj().max(0.2)
    }).toThrow(/must be an integer/)
  }

  testArray () {
    expect(() => {
      S.arr().min(0.2)
    }).toThrow(/must be an integer/)

    expect(() => {
      S.arr().max(0.2)
    }).toThrow(/must be an integer/)
  }

  testNumber () {
    S.double.min(0.2)
    expect(() => {
      S.double.min('123')
    }).toThrow(/must be a number/)

    S.double.max(0.2)
    expect(() => {
      S.double.max('123')
    }).toThrow(/must be a number/)
  }

  testInteger () {
    expect(() => {
      S.int.min(0.2)
    }).toThrow(/must be an integer/)

    expect(() => {
      S.int.max(0.2)
    }).toThrow(/must be an integer/)
  }

  testString () {
    expect(() => {
      S.str.enum('oij')
    }).toThrow(/must be an array/)

    expect(() => {
      S.str.enum([])
    }).toThrow(/contain at least 1 value/)

    expect(() => {
      S.str.min(0.2)
    }).toThrow(/must be an integer/)

    expect(() => {
      S.str.max(0.2)
    }).toThrow(/must be an integer/)
  }
}

class NewFeatureTest extends BaseTest {
  testObject () {
    P.object()
      .maxProperties(2)
      .minProperties(1)
      .prop('a', P.integer())
      .verify()
  }

  testObjectAdditionalPropsOkay () {
    // empty object => additional properties allowed
    expect(S.obj().jsonSchema().additionalProperties).toBe(true)

    // non-empty object => additional properties NOT allowed (by default)
    const nonEmptyObj = S.obj().prop('x', S.str)
    expect(nonEmptyObj.jsonSchema().additionalProperties).toBe(false)

    // non-empty allowed additional props if explicitly allowed
    nonEmptyObj.additionalProperties = true
    expect(nonEmptyObj.jsonSchema().additionalProperties).toBe(true)
  }

  testRequiredByDefault () {
    expect(S.obj().required).toBe(true)
    expect(S.obj()
      .prop('a', S.int)
      .jsonSchema()
      .required
    )
      .toStrictEqual(['a'])
  }

  testHasDefault () {
    expect(S.int.hasDefault()).toBe(false)
    expect(S.int.default(3).hasDefault()).toBe(true)
    expect(S.int.default(undefined).hasDefault()).toBe(true)
  }

  testGetDefault () {
    expect(S.int.getDefault()).toBe(undefined)
    expect(S.int.default(2).getDefault()).toBe(2)
  }

  testTraverseSchema () {
    const callbackFn = (schema) => { schema.__properties.description = 'test' }
    const schema = S.obj({
      int: S.int,
      bool: S.bool,
      string: S.str,
      number: S.double,
      arr: S.arr(S.obj({
        int: S.int,
        bool: S.bool,
        map: S.map.value(S.int),
        arrNoSchema: S.arr()
      }))
    })

    schema.traverseSchema(callbackFn)

    expect(schema.properties().description).toBe('test')
    let nestedSchemas = schema.objectSchemas
    expect(nestedSchemas.int.properties().description).toBe('test')
    expect(nestedSchemas.bool.properties().description).toBe('test')
    expect(nestedSchemas.string.properties().description).toBe('test')
    expect(nestedSchemas.number.properties().description).toBe('test')
    expect(nestedSchemas.arr.properties().description).toBe('test')

    nestedSchemas = nestedSchemas.arr.itemsSchema.objectSchemas
    expect(nestedSchemas.int.properties().description).toBe('test')
    expect(nestedSchemas.bool.properties().description).toBe('test')
    expect(nestedSchemas.map.properties().description).toBe('test')
    expect(nestedSchemas.arrNoSchema.properties().description).toBe('test')
    expect(nestedSchemas.map.objectSchema.objectSchemas.value.properties().description).toBe('test')
  }

  /**
   * Verify S.optional sets all passed schemas to optional()
   */
  testOptional () {
    const result = S.optional({
      int: S.int,
      obj: S.obj({ key: S.str }),
      arr: S.arr(S.int),
      bool: S.bool,
      map: S.map.key(S.str).value(S.str)
    })
    Object.values(result)
      .forEach(schema => expect(schema.properties().optional).toBe(true))

    // optional should not be applied to nested schemas
    expect(result.obj.objectSchemas.key.properties().optional).not.toBe(true)
    expect(result.arr.itemsSchema.properties().optional).not.toBe(true)
    expect(result.map.objectSchema.objectSchemas.value.properties().optional).not.toBe(true)
  }

  testArray () {
    P.array().maxItems(2).minItems(1).verify()
  }

  testString () {
    P.string().maxLength(2).minLength(1).verify()
  }

  testNumber () {
    P.number().maximum(2).minimum(1).verify()
  }

  testInteger () {
    P.integer().maximum(2).minimum(1).verify()
  }

  testBoolean () {
    P.boolean().verify()
  }

  testMap () {
    // ex0 start
    const fs = S.arr(S.obj({
      key: S.str.min(1).pattern('123123'),
      value: S.arr().max(123).items(S.int)
    })
      .max(2)
      .min(2) // Limit object to contain only `key` and `value`
    )
    // ex1 start
    const s = S.map
      .key(S.str.min(1).pattern('123123'))
      .value(S.arr().max(123).items(S.int))
    // ex1 end
    expect(s.jsonSchema()).toStrictEqual(fs.valueOf())
    expect(s.copy().jsonSchema()).toStrictEqual(fs.valueOf())
    s.lock()
    expect(s.__isLocked).toBe(true)

    expect(() => {
      S.map.items()
    }).toThrow(/Map does not support Items/)

    expect(() => {
      S.map.key(S.str.optional())
    }).toThrow(/key must be required/)

    expect(() => {
      S.map.key(S.int)
    }).toThrow(/Key must be strings/)

    expect(() => {
      S.map.value(S.str.optional())
    }).toThrow(/value must be required/)

    expect(S.map.value(S.str).jsonSchema().items.properties.key)
      .toStrictEqual({ type: 'string' })
    expect(() => {
      S.map.jsonSchema()
    }).toThrow(/Must have a value schema/)
  }

  testCopy () {
    const str = S.str.max(1).min(1).title('aa')
    expect(str.jsonSchema()).toStrictEqual(str.copy().jsonSchema())

    const obj = S.obj().prop('a', str).desc('something')
    expect(obj.jsonSchema()).toStrictEqual(obj.copy().jsonSchema())

    const arr = S.arr(obj)
    expect(arr.jsonSchema()).toStrictEqual(arr.copy().jsonSchema())

    const patternObj = S.obj().patternProps({ '^xyz.*$': str })
    expect(patternObj.jsonSchema())
      .toStrictEqual(patternObj.copy().jsonSchema())
  }

  testCopyIsolation () {
    // Changes to a copy should not affect original
    const a = S.str
    const b = a.copy().min(1)
    expect(a.jsonSchema()).not.toStrictEqual(b.jsonSchema())
  }

  testAutoLocking () {
    const a = S.str
    S.obj({ a })
    expect(() => {
      a.min(1)
    }).toThrow('is locked')
    const a2 = a.desc('aaa')
    const aSchema = a.jsonSchema()
    const a2Schema = a2.jsonSchema()
    expect(aSchema.description).toBe(undefined)
    expect(a2Schema.description).toBe('aaa')

    const b = S.str
    S.arr(b)
    expect(() => {
      b.min(1)
    }).toThrow('is locked')

    const c = S.str
    S.map.value(c)
    expect(() => {
      c.min(1)
    }).toThrow('is locked')
  }

  testJsonSchemaIsolation () {
    // JsonSchemas should be copied, and changes to the returned value
    // should not be reflected to the json schema returned in next call.
    const str = S.str
    const a = str.jsonSchema()
    a.something = 1
    const b = str.jsonSchema()
    expect(a).not.toStrictEqual(b)
  }

  testInnerSchemaMutation () {
    // When a schema is passed into another schema, then get modified, the
    // modification should not affect the previous owner schema
    const inner = S.str
    S.obj({ a: inner })
    expect(() => {
      inner.min(1)
    }).toThrow(/is locked/)

    inner.copy().min(1) // OK to change a copy.
    // No changes are made to the original object.
    expect(inner.jsonSchema().minLength).toBe(undefined)
  }

  testProps () {
    const prop = S.obj()
      .prop('a', S.str)
      .prop('b', S.int)
      .prop('c', S.bool.optional())
    const props = S.obj().props({
      a: S.str,
      b: S.int,
      c: S.bool.optional()
    })
    expect(prop.jsonSchema()).toStrictEqual(props.jsonSchema())

    const init = S.obj({
      a: S.str,
      b: S.int,
      c: S.bool.optional()
    })
    expect(prop.jsonSchema()).toStrictEqual(init.jsonSchema())
  }

  testArrayInit () {
    const a = S.arr()
      .items(S.obj({
        x: S.str.desc('abcds')
      }))
    const b = S.arr(S.obj({
      x: S.str.desc('abcds')
    }))
    expect(a.jsonSchema()).toStrictEqual(b.jsonSchema())
  }

  testLongDescription () {
    const intWithDescription = S.int.desc(`
this will
get combined
into **one** string`)
    expect(intWithDescription.jsonSchema().description)
      .toBe('this will get combined into **one** string')
  }

  testLongExamples () {
    const intWithExamples = S.int
      .examples([
        'Example 1',
        'Example 2',
        [
          'Example',
          '3',
          'is',
          'long.'
        ]
      ])
    expect(intWithExamples.jsonSchema().examples)
      .toStrictEqual([
        'Example 1',
        'Example 2',
        'Example 3 is long.'
      ])
  }

  testPropOverwrite () {
    const str = S.str.min(1)
    expect(() => {
      str.min(1)
    }).toThrow('is already set')

    expect(() => {
      // Critical properties cannot be overwritten even after copying
      str.copy().min(1)
    }).toThrow('is already set')
  }

  testCompile () {
    const schema = S.str.min(2)
    const assertValid = schema.compile('testSchema', ajv, false)
    expect(schema.__isLocked).toBe(true)
    expect(() => assertValid(3)).toThrow(S.ValidationError)
    expect(() => assertValid('3')).toThrow('Validation Error: testSchema')

    // can compile with the built-in ajv too
    const x = schema.getValidatorAndJSONSchema('testSchema')
    expect(() => x.assertValid(3)).toThrow(S.ValidationError)
    expect(() => x.assertValid('3')).toThrow('Validation Error: testSchema')
    expect(x.jsonSchema).toEqual(schema.jsonSchema())
  }

  testPatternPropsValidation () {
    const regexStr = '^xyz-.*$'
    const schema = S.obj().patternProps({ [regexStr]: S.str })
    const validateOrDie = schema.compile('testSchema', ajv, false)
    expect(() => validateOrDie({ bad: 'key' })).toThrow(S.ValidationError)
    validateOrDie({ 'xyz-okay': 'no problem', 'xyz-also-fine': '' })
    expect(() => validateOrDie({ 'xyz-key-ok': 3 })).toThrow(S.ValidationError)
  }
}

runTests(FeatureParityTest, ValidationTest, NewFeatureTest)
