// TODO - Remove when MeshLayer is officially exported in deck.gl
import {Layer} from '@deck.gl/core';
import GL from 'luma.gl/constants';
import {Model, Geometry, loadTextures, Texture2D, fp64} from 'luma.gl';
const {fp64LowPart} = fp64;

import vs from './mesh-layer-vertex.glsl';
import fs from './mesh-layer-fragment.glsl';

const RADIAN_PER_DEGREE = Math.PI / 180;

/*
 * Load image data into luma.gl Texture2D objects
 * @param {WebGLContext} gl
 * @param {String|Texture2D|HTMLImageElement|Uint8ClampedArray} src - source of image data
 *   can be url string, Texture2D object, HTMLImageElement or pixel array
 * @returns {Promise} resolves to an object with name -> texture mapping
 */
function getTexture(gl, src, opts) {
  if (typeof src === 'string') {
    // Url, load the image
    return loadTextures(gl, Object.assign({urls: [src]}, opts))
      .then(textures => textures[0])
      .catch(error => {
        throw new Error(`Could not load texture from ${src}: ${error}`);
      });
  }
  return new Promise(resolve => resolve(getTextureFromData(gl, src, opts)));
}

/*
 * Convert image data into texture
 * @returns {Texture2D} texture
 */
function getTextureFromData(gl, data, opts) {
  if (data instanceof Texture2D) {
    return data;
  }
  return new Texture2D(gl, Object.assign({data}, opts));
}

function validateGeometryAttributes(attributes) {
  if (attributes.positions) {
    return;
  }
  throw Error('invalid mesh');
}

/*
 * Convert mesh data into geometry
 * @returns {Geometry} geometry
 */
function getGeometry(data) {
  if (data instanceof Geometry) {
    validateGeometryAttributes(data.attributes);
    return data;
  } else if (typeof data === 'object') {
    validateGeometryAttributes(data);
    return new Geometry({
      attributes: data
    });
  }
  throw Error('Invalid mesh');
}

const DEFAULT_COLOR = [0, 0, 0, 255];
const defaultProps = {
  mesh: {type: 'object', value: null, async: true},
  texture: null,
  sizeScale: {type: 'number', value: 1, min: 0},
  desaturate: {type: 'number', value: 0, min: 0},
  brightness: {type: 'number', value: 0, min: 0},

  fp64: false,
  wireframe: false,
  // Optional settings for 'lighting' shader module
  lightSettings: {},

  getPosition: {type: 'accessor', value: x => x.position},
  getColor: {type: 'accessor', value: DEFAULT_COLOR},

  // yaw, pitch and roll are in degrees
  // https://en.wikipedia.org/wiki/Euler_angles
  getYaw: {type: 'accessor', value: d => d.yaw || 0},
  getPitch: {type: 'accessor', value: d => d.pitch || 0},
  getRoll: {type: 'accessor', value: d => d.roll || 0}
};

export default class MeshLayer extends Layer {
  getShaders() {
    const projectModule = this.use64bitProjection() ? 'project64' : 'project32';
    return {vs, fs, modules: [projectModule, 'lighting', 'picking']};
  }

  initializeState() {
    const attributeManager = this.getAttributeManager();
    attributeManager.addInstanced({
      instancePositions: {
        size: 3,
        transition: true,
        accessor: 'getPosition'
      },
      instancePositions64xy: {
        size: 2,
        accessor: 'getPosition',
        update: this.calculateInstancePositions64xyLow
      },
      instanceRotations: {
        size: 3,
        transition: true,
        accessor: ['getYaw', 'getPitch', 'getRoll'],
        update: this.calculateInstanceRotations
      },
      instanceColors: {
        size: 4,
        transition: true,
        type: GL.UNSIGNED_BYTE,
        accessor: 'getColor',
        defaultValue: [0, 0, 0, 255]
      }
    });

    this.setState({
      // Avoid luma.gl's missing uniform warning
      // TODO - add feature to luma.gl to specify ignored uniforms?
      emptyTexture: new Texture2D(this.context.gl, {
        data: new Uint8Array(4),
        width: 1,
        height: 1
      })
    });
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags});

    if (props.mesh && (props.fp64 !== oldProps.fp64 || props.mesh !== oldProps.mesh)) {
      const {gl} = this.context;
      if (this.state.model) {
        this.state.model.delete();
      }
      this.setState({model: this._getModel(gl)});
      this.getAttributeManager().invalidateAll();
    }

    if (props.texture !== oldProps.texture) {
      this.setTexture(props.texture);
    }

    if (props.mesh && props.wireframe !== oldProps.wireframe) {
      this.state.model.setDrawMode(props.wireframe ? GL.LINE_STRIP : GL.TRIANGLES);
    }
  }

  draw({uniforms}) {
    const {sizeScale, desaturate, brightness} = this.props;
    const {texture, emptyTexture, model} = this.state;

    if (!model) {
      return;
    }

    model.render(
      Object.assign({}, uniforms, {
        sampler: texture || emptyTexture,
        hasTexture: Boolean(texture),
        sizeScale,
        desaturate,
        brightness
      })
    );
  }

  _getModel(gl) {
    return new Model(
      gl,
      Object.assign({}, this.getShaders(), {
        id: this.props.id,
        geometry: getGeometry(this.props.mesh),
        isInstanced: true,
        shaderCache: this.context.shaderCache,
        drawMode: this.props.wireframe ? GL.LINE_STRIP : GL.TRIANGLES
      })
    );
  }

  setTexture(src) {
    const {gl} = this.context;

    if (src) {
      getTexture(gl, src).then(texture => {
        this.setState({texture});
      });
    } else {
      this.setState({texture: null});
    }
  }

  calculateInstancePositions64xyLow(attribute) {
    const isFP64 = this.use64bitPositions();
    attribute.constant = !isFP64;

    if (!isFP64) {
      attribute.value = new Float32Array(2);
      return;
    }

    const {data, getPosition} = this.props;
    const {value} = attribute;
    let i = 0;
    for (const point of data) {
      const position = getPosition(point);
      value[i++] = fp64LowPart(position[0]);
      value[i++] = fp64LowPart(position[1]);
    }
  }

  // yaw(z), pitch(y) and roll(x) in radians
  calculateInstanceRotations(attribute) {
    const {data, getYaw, getPitch, getRoll} = this.props;
    const {value} = attribute;
    let i = 0;
    for (const point of data) {
      value[i++] = getRoll(point) * RADIAN_PER_DEGREE;
      value[i++] = getPitch(point) * RADIAN_PER_DEGREE;
      value[i++] = getYaw(point) * RADIAN_PER_DEGREE;
    }
  }
}

MeshLayer.layerName = 'MeshLayer';
MeshLayer.defaultProps = defaultProps;
