## `GLBParser` class

The `GLBParser` class lets the application access data encoded in a GLB binary "envelope".  Most applications would use the `glTFParser` class instead (which uses the `GLBParser` class under the hood to parse GLB-encoded glTF files).

However, the GLB encoding can potentially also be used independently to save mixed JSON and binary data, in which case having access to the `GLBParser` class can be helpful.

References:
* For more information, see [GLB and GLB support]() in the Developer's Guide.

## Usage

```
import {GLBParser} from '@loaders.gl/gltf';
import {loadBinaryFile} from '@loaders.gl/core';

// Create a parser
const glbParser = new GLBParser();

// Load and parse a file
const GLB_BINARY = loadBinaryFile(...);
glbParser.parse(GLB_BINARY);

// Get the complete GLB JSON structure
const gltfJson = glbParser.getJSON();

// Get specific fields from the JSON structure
const appData = glbParser.getApplicationData('customData');
```

## Methods

### constructor(options : Object)

Creates a new `GLBParser` instance.

### parse(arrayBuffer : ArrayBuffer) : Object

Parses an in-memory, GLB formatted `ArrayBuffer` into:

* `arrayBuffer` - just returns the input array buffer
* `binaryByteOffset` - offset to the first byte in the binary chunk
* `json` - a JavaScript "JSON" data structure with inlined binary data fields.
