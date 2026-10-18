(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const canvas = el('sky'), count = el('count'), size = el('size'), rotate = el('rotate');
  const fail = message => { el('error').textContent = message; el('error').hidden = false; };
  const gl = canvas.getContext('webgl', {alpha:false, antialias:true});
  if (!gl) { fail('WebGL is unavailable. Enable hardware acceleration or try a browser with WebGL support.'); return; }
  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  }
  const program = gl.createProgram();
  try {
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `
      attribute vec3 position;
      attribute vec3 color;
      varying vec3 starColor;
      varying float brightness;
      uniform mat4 projection, view;
      uniform float starSize, pixelScale, maxPointSize;
      void main() {
        vec4 camera = view * vec4(position, 1.0);
        gl_Position = projection * camera;
        starColor = color;
        // Softened inverse-square falloff using actual camera distance.
        float d = length(camera.xyz);
        brightness = 1.0 / (1.0 + 0.035 * d * d);
        gl_PointSize = clamp(starSize * pixelScale / max(0.01, -camera.z), 1.0, maxPointSize);
      }`));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 starColor;
      varying float brightness;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (radius > 1.0) discard;
        gl_FragColor = vec4(starColor * brightness, 1.0 - smoothstep(0.25, 1.0, radius));
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (cause) { fail('Could not initialize the starfield: ' + cause.message); return; }
  // A full-screen procedural nebula on the distant sky, behind the stars.
  const nebula = gl.createProgram();
  try {
    gl.attachShader(nebula, shader(gl.VERTEX_SHADER, `
      attribute vec2 corner;
      varying vec2 uv;
      void main() { uv=corner; gl_Position=vec4(corner,0.0,1.0); }
    `));
    gl.attachShader(nebula, shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 uv;
      uniform float aspect, yaw, pitch;
      float hash(vec3 p) { return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*437.58); }
      float noise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                       mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                       mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float cloud(vec3 p) {
        float n=0.0, a=0.5;
        for(int i=0;i<4;i++) { n+=a*noise(p); p=p*2.03+vec3(7.1); a*=0.5; }
        return n;
      }
      // Angular sky coordinates keep distant galaxies fixed while orbiting.
      vec3 galaxy(vec3 ray, vec3 center, float scale, float tilt, float flatten) {
        vec3 normal=normalize(center);
        float facing=dot(ray,normal);
        if(facing<0.96) return vec3(0.0);
        vec3 right=normalize(cross(vec3(0.0,1.0,0.0),normal));
        vec3 up=cross(normal,right);
        vec2 p=vec2(dot(ray,right),dot(ray,up))/scale;
        p=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*p;
        p.y/=flatten;
        float radius=length(p);
        if(radius>4.0) return vec3(0.0);
        float angle=atan(p.y,p.x);
        float arms=0.5+0.5*cos(angle*2.0-radius*5.5);
        float disk=exp(-radius*1.6)*(1.0-smoothstep(0.0,3.5,radius));
        float spiral=pow(arms,3.0)*disk*smoothstep(0.15,0.8,radius);
        float core=exp(-radius*radius*15.0);
        return vec3(0.56,0.65,0.90)*(disk*0.12+spiral*0.23)
             + vec3(1.0,0.84,0.60)*core*0.65;
      }
      void main() {
        vec3 ray=normalize(vec3(uv.x*aspect*0.57735,uv.y*0.57735,-1.0));
        float sy=sin(yaw),cy=cos(yaw),sp=sin(pitch),cp=cos(pitch);
        vec3 direction=vec3(cy*ray.x-sy*sp*ray.y+sy*cp*ray.z,
                            cp*ray.y+sp*ray.z,
                            -sy*ray.x-cy*sp*ray.y+cy*cp*ray.z);
        float wisps=cloud(direction*5.0+vec3(12.0));
        float band=exp(-pow((direction.y+0.30*direction.x-0.1)*3.0,2.0));
        float density=smoothstep(0.25,0.78,wisps)*band;
        vec3 tint=mix(vec3(0.13,0.26,0.42),vec3(0.38,0.13,0.32),cloud(direction*2.0));
        vec3 galaxies=galaxy(direction,vec3(0.55,0.30,1.0),0.023,0.65,0.52)
                     +galaxy(direction,vec3(-0.48,-0.26,1.0),0.016,-0.4,0.30)
                     +galaxy(direction,vec3(0.90,-0.40,-1.0),0.020,1.1,0.65)
                     +galaxy(direction,vec3(-1.0,0.55,-0.30),0.013,-0.8,0.45);
        gl_FragColor=vec4(tint*density*0.18+galaxies,1.0);
      }
    `));
    gl.linkProgram(nebula);
    if (!gl.getProgramParameter(nebula,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(nebula));
  } catch(cause) { fail('Could not initialize nebula: '+cause.message); return; }
  const corners=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,corners);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const corner=gl.getAttribLocation(nebula,'corner');
  const nebulaUniforms=Object.fromEntries(['aspect','yaw','pitch'].map(n=>[n,gl.getUniformLocation(nebula,n)]));
  gl.useProgram(program);
  const uniforms = Object.fromEntries(['projection','view','starSize','pixelScale','maxPointSize'].map(name => [name,gl.getUniformLocation(program,name)]));
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const position = gl.getAttribLocation(program,'position');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);
  const color = gl.getAttribLocation(program,'color');
  gl.enableVertexAttribArray(color); gl.vertexAttribPointer(color,3,gl.FLOAT,false,24,12);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE); gl.clearColor(0,0,0,1);
  gl.uniform1f(uniforms.maxPointSize,gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
  let yaw = Math.PI, pitch = Math.atan(0.1), distance = Math.hypot(10,1);
  let frame = 0, previousTime = 0, dragging = null, lost = false;
  function requestRender() { if (!frame && !lost && !document.hidden) frame = requestAnimationFrame(render); }
  // Uniform sampling of the sphere volume, as in Unity Random.insideUnitSphere.
  function generate() {
    const points = new Float32Array(Number(count.value)*6);
    const palette = [[1,0.40,0.20],[1,0.70,0.38],[1,0.91,0.72],[0.92,0.96,1],[0.48,0.70,1]];
    for (let i=0; i<points.length; i+=6) {
      let x,y,z;
      do { x=Math.random()*2-1; y=Math.random()*2-1; z=Math.random()*2-1; } while (x*x+y*y+z*z>1);
      points[i]=x*10; points[i+1]=y*10; points[i+2]=z*10;
      // Blend neighboring warm orange, gold, ivory, white and blue tones.
      const t = Math.random() * (palette.length - 1);
      const k = Math.floor(t), mix = t-k;
      for (let c=0;c<3;c++) points[i+3+c]=palette[k][c]*(1-mix)+palette[k+1][c]*mix;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,points,gl.STATIC_DRAW);
    el('count-value').value=Number(count.value).toLocaleString('en-US');
    el('status').textContent=Number(count.value).toLocaleString('en-US')+' stars · sphere radius 10';
    requestRender();
  }
  function render(time) {
    frame=0;
    if (rotate.checked && previousTime) yaw+=Math.min((time-previousTime)/1000,0.05)*0.08;
    previousTime=time;
    const scale=Math.min(devicePixelRatio||1,2);
    const width=Math.max(1,Math.round(canvas.clientWidth*scale)), height=Math.max(1,Math.round(canvas.clientHeight*scale));
    if (canvas.width!==width || canvas.height!==height) {canvas.width=width; canvas.height=height;}
    gl.viewport(0,0,width,height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(nebula);
    gl.bindBuffer(gl.ARRAY_BUFFER,corners);
    gl.disableVertexAttribArray(position); gl.disableVertexAttribArray(color);
    gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner,2,gl.FLOAT,false,0,0);
    gl.uniform1f(nebulaUniforms.aspect,width/height);
    gl.uniform1f(nebulaUniforms.yaw,yaw); gl.uniform1f(nebulaUniforms.pitch,pitch);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.disableVertexAttribArray(corner);
    gl.useProgram(program); gl.enable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(color); gl.vertexAttribPointer(color,3,gl.FLOAT,false,24,12);
    const f=1/Math.tan(Math.PI/6), near=0.01, far=200;
    gl.uniformMatrix4fv(uniforms.projection,false,new Float32Array([
      f/(width/height),0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0
    ]));
    // Initial camera at (0, 1, -10), facing the center of the sphere.
    const sy=Math.sin(yaw), cy=Math.cos(yaw), sp=Math.sin(pitch), cp=Math.cos(pitch);
    gl.uniformMatrix4fv(uniforms.view,false,new Float32Array([
      cy,-sy*sp,sy*cp,0, 0,cp,sp,0, -sy,-cy*sp,cy*cp,0, 0,0,-distance,1
    ]));
    gl.uniform1f(uniforms.starSize,Number(size.value)); gl.uniform1f(uniforms.pixelScale,height*f/2);
    gl.drawArrays(gl.POINTS,0,Number(count.value));
    if (rotate.checked) requestRender();
  }
  count.addEventListener('input',generate);
  size.addEventListener('input',()=>{el('size-value').value=Number(size.value).toFixed(3);requestRender();});
  rotate.addEventListener('change',()=>{previousTime=0;requestRender();});
  el('regenerate').addEventListener('click',generate);
  el('reset').addEventListener('click',()=>{
    yaw=Math.PI;pitch=Math.atan(0.1);distance=Math.hypot(10,1);
    count.value='1000';size.value='0.05';rotate.checked=false;el('size-value').value='0.050';generate();
  });
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0 || dragging)return;
    dragging={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!dragging || event.pointerId!==dragging.id)return;
    yaw-=(event.clientX-dragging.x)*0.005;
    pitch=Math.max(-1.5,Math.min(1.5,pitch+(event.clientY-dragging.y)*0.005));
    dragging.x=event.clientX;dragging.y=event.clientY;requestRender();
  });
  canvas.addEventListener('lostpointercapture',()=>{dragging=null;});
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1);
    distance=Math.max(0.3,Math.min(60,distance*Math.exp(Math.max(-1,Math.min(1,delta*0.001)))));requestRender();
  },{passive:false});
  window.addEventListener('resize',requestRender);
  document.addEventListener('visibilitychange',()=>{previousTime=0;requestRender();});
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;
    fail('The graphics connection was interrupted. Reload this page to restore the starfield.');
  });
  generate();
})();
