# Schema Library <!-- omit in toc -->
Todea Schema library allows developers to quickly construct [JSON Schema](https://json-schema.org/understanding-json-schema/reference/index.html) and [AWS C2J Shape Schema](aws-c2j.md) without managing large JSON objects directly. It implements a subset of [the JSON Schema specification](https://json-schema.org/understanding-json-schema/reference/index.html) and a [fluent-schema](https://github.com/fastify/fluent-schema) like API.

This document assumes prior knowledge of [JSON Schema](https://json-schema.org/understanding-json-schema/reference/index.html) and [fluent-schema API](https://github.com/fastify/fluent-schema) and will only discuss features unique to this library. Please familiarize yourself with the linked docs before continuing.

- [Convenient](#convenient)
  - [Shorthand Syntax](#shorthand-syntax)
  - [Pattern Properties](#pattern-properties)
  - [Long Descriptions](#long-descriptions)
  - [Long Examples](#long-examples)
  - [Map Schema](#map-schema)
  - [Media Schema](#media-schema)
  - [Validating Data](#validating-data)
  - [Common Schemas](#common-schemas)
  - [Getting JSON Schema](#getting-json-schema)
  - [Export schemas](#export-schemas)
  - [Fluent-schema compatible](#fluent-schema-compatible)
- [Secure](#secure)
  - [Deprecated JSON Schema Features](#deprecated-json-schema-features)
  - [Required By Default](#required-by-default)
  - [Set Once Only](#set-once-only)
  - [Lock & Copy](#lock--copy)
  - [Explicit Keys](#explicit-keys)
- [Efficient](#efficient)
  - [In-Place Mutation](#in-place-mutation)
  - [Explicit Copy](#explicit-copy)


# Convenient
To start using the schema library, import the module first
```javascript
const S = require('../../sharedlib/src/schema')
```

## Shorthand Syntax
This library replaces a few fluent-schema APIs with shorter syntax.
```javascript
// Create schema object
S.obj()                // replace S.object()
S.obj({ key: schema }) // is the same as S.object().props({ key: schema })
S.arr()                // replace S.array()
S.arr(schema)          // is the same as S.array().items(schema)
S.str                  // replace S.string()
S.double               // replace S.number()
S.int                  // replace S.integer()
S.bool                 // replace S.boolean()

// Common API for all schema objects
S.str() // Or any other schema object
  .desc('A more details description') // replace description()

// min / max are polymorphic
S.obj().max(5).min(2)   // replace maxProperties() & minProperties()
S.arr().max(1).min(1)   // replace maxItems() & minItems()
S.str.max(3).min(2)     // replace maxLength() & minLength()
S.double.max(0.5).min(0.2) // replace maximum() & minimum()
S.int.max(2).min(1)     // replace maximum() & minimum()
```

Multiple calls to `prop()` can be simplified to one single call on `props()`. `props()` takes an object as input. Keys in the input object must be strings and values must be schema objects. The `S.obj({})` syntax simplifies `S.obj().props({})` further.
```javascript <!-- embed:../test/unit-test-schema.js:scope:testProps -->
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
```

Similarly, `S.arr().items(schema)` can be simplified to `S.arr(schema)`.

## Pattern Properties
You may allow an object to contain any keys matching a given pattern via the
`patternProps` method. For example,
```javascript <!-- embed:../test/unit-test-aws-c2j.js:section:pattern obj example start:pattern obj example end -->
      S.obj().patternProps({ 'xyz-.*': S.str })
```

Patterns have start and end anchors (`^` and `$`) automatically added to only
allow properties which exactly match the regex. To find a substring (or prefix
or suffix) you can use start and/or end your pattern with the `.*` pattern.

## Long Descriptions
Long descriptions can should use multiline Node strings. These strings will be joined by a space character to form the final description. Keep in mind that Markdown is supported in descriptions rendered to Swagger.
```javascript <!-- embed:../test/unit-test-schema.js:scope:testLongDescription -->
  testLongDescription () {
    const intWithDescription = S.int.desc(`
this will
get combined
into **one** string`)
    expect(intWithDescription.jsonSchema().description)
      .toBe('this will get combined into **one** string')
  }
```

## Long Examples
Examples can be provided via `examples()` API. Parameter is an array of examples. For a long example, an array of strings can be provided and they will be joined by a space character.
```javascript <!-- embed:../test/unit-test-schema.js:scope:testLongExamples -->
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
```

## Map Schema
The Map schema contains a collection of key-value pairs. This feature replaces a few deprecated JSON Schemas features mentioned [here](#deprecated-json-schema-features). Instead of writing the following schema:
```javascript <!-- embed:../test/unit-test-schema.js:section:ex0 start:ex1 start -->
    const fs = S.arr(S.obj({
      key: S.str.min(1).pattern('123123'),
      value: S.arr().max(123).items(S.int)
    })
      .max(2)
      .min(2) // Limit object to contain only `key` and `value`
    )
```

The map shorthand can be used with less typing:
```javascript <!-- embed:../test/unit-test-schema.js:section:ex1 start:ex1 end -->
    const s = S.map
      .key(S.str.min(1).pattern('123123'))
      .value(S.arr().max(123).items(S.int))
```

NOTE: This schema produces cleaner client SDK interfaces than using the more complex array of objects schema.

## Media Schema
Media schema can be used for rich content like `.tar` files, images and custom data blobs. Content type and content encoding can be specified using `type('application/tar')` and `encoding('base64')` respectively.

For example
```javascript
const s = S.media.type('application/image').encoding('base64')
```

After receiving the data, it should decoded accordingly.
```javascript
const decoded = Base64.decode(data)
```

Alternatively the data can be forwarded to a library that handled encoded data
```javascript
const zip = (new JSZip()).loadAsync(data, { base64: true })
```

## Validating Data
Schema is compiled into a validator that can be used to efficiently validate
data. When compiling a schema, a name must be provided. The name should
uniquely identify a schema, so a validation failures can be quickly linked back
to the source.
```javascript
const s = S.str
const validator = s.compile('inputValidation')
validator('123')
expect(validator('123')).toThrow()
```

Schema library uses AJV as the json validator compiler. You can provide your
custom JSON schema validator too.
```javascript
const customValidator = s.compile('inputValidation', new AJV())
```

The `compile` function may optionally return both the JSON schema object and a
validator by passing the truthy value as the 3rd parameter.
```javascript
const { jsonSchema, assertValid } = s.compile('inputValidation', undefined /* to use the default compiler */, true)
assertValid('123')
expect(assertValid('123')).toThrow()
```

## Common Schemas
In addition to the schema constructors, this library also exports a collection
of commonly used schemas. These schemas are available in the `S.SCHEMAS`
property. For example:
- S.SCHEMAS.UUID: A schema for UUIDs.
- S.SCHEMAS.STR_ANDU: A schema for alphanumeric strings with dashes and underscores.

## Getting JSON Schema
Detect a Todea Schema object by checking `isTodeaSchema`. Extract JSON schema by calling `jsonSchema()` on a Todea Schema.
```javascript
if (schema.isTodeaSchema) {
  schema.jsonSchema()
}
```

## Export schemas
Todea schema can be extended to support exporting to custom schemas. It can be done via the `export` method which uses a visitor pattern. A custom exporter needs to implement the follow interface:
```javascript
class SchemaExporter {
  exportString (schema) {}
  exportInteger (schema) {}
  exportNumber (schema) {}
  exportObject (schema) {}
  exportArray (schema) {}
  exportBoolean (schema) {}
  exportMap (schema) {}
  exportMedia (schema) {}
}
```

Then use the exporter like
```javascript
const exportedSchema = S.obj().export(new SchemaExporter())
```

## Fluent-schema compatible
For libraries that accepts a fluent-schema object as the parameter (e.g. fastify), you may pass Todea Schema objects instead. Todea Schema implements fluent-schema's `isFluentSchema` and `valueOf()` APIs to achieve compatibility.

# Secure
## Deprecated JSON Schema Features
This library deprecates many advanced / niche features from the JSON Schema spec in favor of correctness.

* BaseSchema

  - Required

    The `required()` API is replaced by `optional()`. See [discussion here](#required-by-default).

  - Enum

    The `enum()` API is only available for `S.str` schemas. There must exist 2 or more values as valid options for the schema. NOTE: This limitation is imposed by SDK generation tools.

* ArraySchema
  - AdditionalItems
  - TupleValidation
  - UniqueItems

  Use ObjectSchema or [MapSchema](#map-schema) instead.

* ObjectSchema
  - AdditionalProperties
  - Dependencies
  - PropertyNames

  Use [MapSchema](#map-schema) instead.

## Required By Default
Every property is required by default to prevent accidental omission of data. Call `optional()` to make a property optional.
```javascript
S.str // required
S.str.optional() // Optional
```

A helper method, `S.optional()` is provided to simplify setting multiple properties as optional.

so this:

```javascript
S.obj({
  int: S.int.optional(),
  bool: S.bool.optional(),
  str: S.str.optional()
})
```

becomes this:
```javscript
S.obj(S.optional({
  int: S.int,
  bool: S.bool,
  str: S.str
}))
```

## Set Once Only
Most critical schema properties can be set only once. Additional attempts to update an already set property result in exceptions.
```javascript <!-- embed:../test/unit-test-schema.js:scope:testPropOverwrite -->
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
```

For ObjectSchema objects, keys passed to `S.obj()`, `prop()` and `props()` must be unique. A duplicated key will trigger an exception.
```javascript <!-- embed:../test/unit-test-schema.js:scope:testObjectPropOverwrite -->
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
```

Metadata properties such as `desc()` can be set more than once. When they are set the second time, a copy of the schema is created, updated and returned. Read more on this behavior in [in-place mutation](#in-place-mutation).

## Lock & Copy
Since schemas in this library are [mutated in-place](#in-place-mutation), when a schema is shared by multiple code path, modifications made in one code path will be observed by another. To avoid this problem, a lock can be placed on the schema.
```javascript
const schema = S.str
  .pattern(/^[a-zA-Z]+$/)
  .lock()
```

When some code tries to modify a locked `schema`, an error is thrown.
```javascript
schema.min(1) // throws an exception
```

A locked schema object can be unlocked by copying; after copying further modifications can be made.
```javascript
const newSchema = schema.copy().min(1)
```

When a schema object is passed into another schema object, e.g. `S.obj.prop()`, `S.arr.items()` or `S.map.value()`, the ownership of the input schema object is transferred to the containing schema object. The input schema object is locked automatically, so further modifications to the nested schema objects are prohibited. This behavior allows the library to only [copy when explicitly requested](#explicit-copy).
```javascript <!-- embed:../test/unit-test-schema.js:scope:testAutoLocking -->
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
```

A helper method, `S.lock()` is provided to simplify locking multiple properties.

so this:

```javascript
S.obj({
  int: S.int.lock(),
  bool: S.bool.lock(),
  str: S.str.lock()
})
```

becomes this:
```javscript
S.obj(S.lock({
  int: S.int,
  bool: S.bool,
  str: S.str
}))
```

## Explicit Keys
By default object schemas will have `additionalProperties` set to false to disallow any undefined keys slipping through validation. There are two exceptions:

  1. When `S.obj()` is transformed into a JSON schema without any property
     defined. In this case, `additionalProperties` is set to true to allow all
     keys, since an empty object as parameter does not make sense.
  1. When `S.obj().additionalProperties` is explicitly set to `true`. This
     should be used very sparingly - only when the API is being called by an
     external source that we cannot control, and whose parameters list may grow
     without warning (this is not typical, even for external sources).

# Efficient
## In-Place Mutation
In contrast to fluent-schema, this library updates schema objects in-place, and requires developers to [lock](#lock--copy) shared schemas to prevent errors. Allocations only happen in the following scenarios:
1. A new schema is created from `S`.
2. A metadata property is [overwritten](#set-once-only).

In the following snippet, 4 schema objects are allocated by fluent-schema, while this library only allocates 1.
```javascript
S.obj().title('t').examples(['e']).desc('something')
```

To further illustrate when new objects are created, consider the code below. Exactly one schema object is allocated on each line.
```javascript
S.str
S.obj().desc('aaa').title('')
S.arr().min(1).max(2)
const myBool = S.bool.desc('aa').title('something')
// myBool is copied; the copy has a different description than myBool
const newSchema = myBool.desc('bb')
```

## Explicit Copy
To avoid hidden costs while using this library, schema copies are generally only made when explicitly requested. Explicit copy works because nested schema objects are [locked as they become nested](#lock--copy). Copies of objects are only created when
- Todea Schema object is copied using `copy()`
- JSON Schema is requested using `jsonSchema()`
- desc() or examples() is called on a locked schema, or a schema which already has those properties defined (this conveniently allows a schema to be used in many places, but given different descriptions based on the context). The copied
schema will be locked after the change is made.

The copying behavior isolates modifications to the returned objects from the original object.
```javascript <!-- embed:../test/unit-test-schema.js:scope:testJsonSchemaIsolation -->
  testJsonSchemaIsolation () {
    // JsonSchemas should be copied, and changes to the returned value
    // should not be reflected to the json schema returned in next call.
    const str = S.str
    const a = str.jsonSchema()
    a.something = 1
    const b = str.jsonSchema()
    expect(a).not.toStrictEqual(b)
  }
```

```javascript <!-- embed:../test/unit-test-schema.js:scope:testInnerSchemaMutation -->
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
```
