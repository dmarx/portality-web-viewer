import './lib/utils/linalg.js';
import './lib/pipeline.js';




import { mat3transpose, mat3multiply, mat4multiply, mat4perspective, mat4lookAt } from './lib/utils/linalg.js';
import { rotorToRotationMatrix, rotorsToCov3D } from './lib/utils/rotors.js';
import { createPipeline, applyPipeline, toTexture } from './lib/pipeline.js';
import { permuteArray } from './lib/pointarray.js';
import loadSplatFile from './lib/splatfile.js';
import createRenderProgram from './lib/rendering/vpshaders.js';



const canvasWidth = 1024;
const canvasHeight = 1024;


let fpsData = {
    then: 0,
    frameTimes: [],
    frameCursor: 0,
    numFrames: 0,
    maxFrames: 20,
    totalFPS: 0
};

function initCanvas() {
    var canvas = document.getElementById("gl-canvas");
    //canvas.width = window.innerWidth;
    //canvas.height = window.innerHeight;

    return canvas;
}

function initWebgl(canvas) {
    var gl = canvas.getContext("webgl2");

    if (!gl) {
        console.error("WebGL 2 not available");
        document.body.innerHTML = "This example requires WebGL 2 which is unavailable on this system."
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    // gl.enable(gl.BLEND);
    // gl.depthMask(false);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!gl.getExtension("EXT_color_buffer_float")) {
        console.error("FLOAT color buffer not available");
        document.body.innerHTML = "This example requires EXT_color_buffer_float which is unavailable on this system."
    }

    return gl;
}

function updateFPSDisplay(fps, averageFPS) {
    const fpsElem = document.querySelector("#fps");
    if (!fpsElem) return;
    fpsElem.textContent = fps.toFixed(1);  // update fps display
    const avgElem = document.querySelector("#avg");
    if (!avgElem) return;
    avgElem.textContent = averageFPS.toFixed(1);  // update avg display
}

function calcFPS(now) {
    const deltaTime = now - fpsData.then;
    fpsData.then = now;
    const fps = 1000 / deltaTime;

    // add the current fps and remove the oldest fps
    fpsData.totalFPS += fps - (fpsData.frameTimes[fpsData.frameCursor] || 0);

    // record the newest fps
    fpsData.frameTimes[fpsData.frameCursor++] = fps;

    // needed so the first N frames, before we have maxFrames, is correct.
    fpsData.numFrames = Math.max(fpsData.numFrames, fpsData.frameCursor);

    // wrap the cursor
    fpsData.frameCursor %= fpsData.maxFrames;

    updateFPSDisplay(fps, fpsData.totalFPS / fpsData.numFrames);
}

function setBuffers(gl, positionData, colorData, covDiagData, covUpperData) {
    let shaderProgram = createRenderProgram(gl);

    // Create buffers for the particle positions and colors.
    var positionBuffer = gl.createBuffer();
    var colorBuffer = gl.createBuffer();
    var covDiagBuffer = gl.createBuffer();
    var covUpperBuffer = gl.createBuffer();

    // Set buffers -----------------------------------------------------
    // Bind vertex position and color data.
    // We ideally want to avoid having to do this each step.
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positionData, gl.DYNAMIC_COPY);
    var positionLoc = gl.getAttribLocation(shaderProgram, "position");
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_COPY);
    var colorLoc = gl.getAttribLocation(shaderProgram, "color");
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(colorLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, covDiagBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, covDiagData, gl.DYNAMIC_COPY);
    var covDiagLoc = gl.getAttribLocation(shaderProgram, "covDiag");
    gl.vertexAttribPointer(covDiagLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(covDiagLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, covUpperBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, covUpperData, gl.DYNAMIC_COPY);
    var covUpperLoc = gl.getAttribLocation(shaderProgram, "covUpper");
    gl.vertexAttribPointer(covUpperLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(covUpperLoc);
}

function makeTextures(gl, position, color, covUpper, covDiag, group_size, n_groups) {
    return {
        position: toTexture(gl, position, group_size, n_groups, 'float', 3),
        color: toTexture(gl, color, group_size, n_groups, 'float', 4),
        covDiag: toTexture(gl, covDiag, group_size, n_groups, 'float', 3),
        covUpper: toTexture(gl, covUpper, group_size, n_groups, 'float', 3)
    }
}

function setTextures(gl, program, permTextures, vertexTextures) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, permTextures.outer.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'perm_outer_idx'), 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, permTextures.inner.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const permInnerIdxLoc = gl.getUniformLocation(program, 'perm_inner_idx');
    gl.uniform1i(permInnerIdxLoc, 0);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, vertexTextures.position.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'positionTexture'), 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, vertexTextures.color.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'colorTexture'), 4);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, vertexTextures.covDiag.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'covDiagTexture'), 5);

    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, vertexTextures.covUpper.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'covUpperTexture'), 6);
}

function renderMain(data) {
    let canvas = initCanvas();
    let gl = initWebgl(canvas);

    let shaderProgram = createRenderProgram(gl);

    // Create objects
    const GROUP_SIZE = 1024; //gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const N_GROUPS = Math.floor(Math.floor(data.positions.length / 3) / GROUP_SIZE);
    const NUM_PARTICLES = GROUP_SIZE * N_GROUPS;
    // const NUM_PARTICLES = 2048000; // for testing only

    const SORT_INTERVAL = 1;

    let positionData = data.positions;
    let colorData = data.colors;

    let covData = rotorsToCov3D(data.scales, data.rotors);
    let covDiagData = covData.diag;
    let covUpperData = covData.upper;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var projMatrix = new Float32Array(16);
    var viewMatrix = new Float32Array(16);
    var eyePosition = [0, 0, 2];
    var viewProjMatrix = new Float32Array(16);

    var viewportScale = new Float32Array([canvas.width, canvas.height]);

    gl.useProgram(shaderProgram);

    var image = new Image();

    var buffer = gl.createBuffer();
    // make this buffer the current 'ELEMENT_ARRAY_BUFFER'
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint32Array(32),
        gl.STATIC_DRAW
    );

    let pipeline = createPipeline(gl, positionData, GROUP_SIZE, N_GROUPS);
    positionData = permuteArray(positionData, pipeline.perm, 3);
    colorData = permuteArray(colorData, pipeline.perm, 4);
    covDiagData = permuteArray(covDiagData, pipeline.perm, 3);
    covUpperData = permuteArray(covUpperData, pipeline.perm, 3);

    let vertexTextures = makeTextures(gl, positionData, colorData, covUpperData, covDiagData, GROUP_SIZE, N_GROUPS);
    var animationFrameId;

    var rotationMatrix = new Float32Array(16);

    var angl = 0.0;
    var i = 0;
    let isMouseDown = false;
    let lastMousePosition = [0, 0];
    var eyePosition = [5, 0, 0]
    var focusPosition = [0, 0, 0]
    var azimuth = 0.0;
    var elevation = 0.0;
    var lookSensitivity = 100.0;

    function draw(now) {
        // Check if the canvas still exists
        if (!document.body.contains(gl.canvas)) {
            cancelAnimationFrame(animationFrameId);
            return;
        }


        
     


        // Set scene transforms.
        // angl += 0.01;

        mat4perspective(projMatrix, Math.PI / 3, canvas.width / canvas.height, 0.1, 20.0);
        // eyePosition = [5.0 * Math.sin(angl), 0.0, 5.0 * Math.cos(angl)];
        mat4lookAt(viewMatrix, eyePosition, focusPosition, [0, -1, 0]);
        mat4multiply(viewProjMatrix, projMatrix, viewMatrix);

        // apply sorting pipeline.
        let permTextures;
        if (i % SORT_INTERVAL == 0) {
            permTextures = applyPipeline(gl, pipeline, eyePosition, viewProjMatrix);
        }

        // Set scene transform uniforms.
        gl.useProgram(shaderProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(shaderProgram, 'uView'), false, viewMatrix);
        gl.uniformMatrix4fv(gl.getUniformLocation(shaderProgram, 'uViewProj'), false, viewProjMatrix);
        gl.uniform3fv(gl.getUniformLocation(shaderProgram, 'uEyePosition'), eyePosition);
        gl.uniform2fv(gl.getUniformLocation(shaderProgram, 'uViewportScale'), viewportScale);

        // Set viewport params.
        gl.viewport(0, 0, canvasWidth, canvasHeight);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, 0, canvasWidth, canvasHeight);


        setTextures(gl, shaderProgram, permTextures, vertexTextures, GROUP_SIZE, N_GROUPS);
        gl.uniform2i(gl.getUniformLocation(shaderProgram, 'textureSize'), GROUP_SIZE, N_GROUPS);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Prepare viewport for rendering and blending.
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);                //gl.drawArrays(gl.POINTS, 0, NUM_PARTICLES);

        // Draw all the vertices as points, in the order given in the element array buffer.
        gl.drawArrays(gl.POINTS, 0, NUM_PARTICLES);

        // Reset values of variables so that other shaders can run.
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        calcFPS(now);


        // Request next animation frame
        animationFrameId = requestAnimationFrame(draw);
    }

    function handleVisibilityChange() {
        if (document.hidden) {
            cancelAnimationFrame(animationFrameId);
        } else {
            animationFrameId = requestAnimationFrame(draw);
        }
    }

    // Event listener for tab visibility
    document.addEventListener("visibilitychange", handleVisibilityChange, false);

    // Start the animation loop
    animationFrameId = requestAnimationFrame(draw);


    var radius = Math.sqrt((eyePosition[0] - focusPosition[0]) ** 2 + (eyePosition[1] - focusPosition[1]) ** 2 + (eyePosition[2] - focusPosition[2]) ** 2)
        
        
        
    // Prevent default right-click context menu on the canvas
    canvas.addEventListener('contextmenu', function(e) {
        e.preventDefault(); // Prevents the default context menu from appearing
    });

    canvas.addEventListener('mousedown', function (event) {
        isMouseDown = true;
        lastMousePosition = [event.clientX, event.clientY];
    });

    canvas.addEventListener('mousemove', function (event) {
        if (event.buttons == 1) {
            // with left click, spin around the focus position
            let dx = event.clientX - lastMousePosition[0];
            let dy = event.clientY - lastMousePosition[1];
            azimuth -= dx / lookSensitivity;
            elevation -= dy / lookSensitivity;
            // Clamp the elevation to [-pi/2, pi/2]
            elevation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, elevation));
            eyePosition[0] = radius * Math.cos(azimuth) * Math.cos(elevation) + focusPosition[0];
            eyePosition[2] = radius * Math.sin(azimuth) * Math.cos(elevation) + focusPosition[2];
            eyePosition[1] = radius * Math.sin(elevation) + focusPosition[1];

            console.log(eyePosition)
            // really, i should be using quaternions to rotate the eye position around the focus position, thanks copilot
            lastMousePosition = [event.clientX, event.clientY];
        } else if (event.buttons == 4) {
            // with middle click, zoom in and out
            let dx = event.clientX - lastMousePosition[0];
            let dy = event.clientY - lastMousePosition[1];
            radius += dy / lookSensitivity;
            // clamp the radius to [0, 10]
            radius = Math.max(0.1, Math.min(30, radius));
            // update eye positions with new radius
            eyePosition[0] = radius * Math.cos(azimuth) * Math.cos(elevation) + focusPosition[0];
            eyePosition[2] = radius * Math.sin(azimuth) * Math.cos(elevation) + focusPosition[2];
            eyePosition[1] = radius * Math.sin(elevation) + focusPosition[1];


            console.log(eyePosition)
            lastMousePosition = [event.clientX, event.clientY];
        } else if (event.buttons == 2) {
            // with right click, move the focus position
            let dx = event.clientX - lastMousePosition[0];
            let dy = event.clientY - lastMousePosition[1];
            // move the focus position around on the surface of a sphere
            // internal elevation is just negative elevation
            elevation -= dy / lookSensitivity;
            // Clamp the elevation to [-pi/2, pi/2]
            elevation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, elevation));
            azimuth -= dx / lookSensitivity;
            focusPosition[0] = radius * Math.cos((azimuth + Math.PI) % (2 * Math.PI)) * Math.cos(-elevation) + eyePosition[0];
            focusPosition[2] = radius * Math.sin((azimuth + Math.PI) % (2 * Math.PI)) * Math.cos(-elevation) + eyePosition[2];
            focusPosition[1] = radius * Math.sin(-elevation) + eyePosition[1];
           
            lastMousePosition = [event.clientX, event.clientY];
        }
        
    });

    canvas.addEventListener('mouseup', function (event) {
        isMouseDown = false;
    });

    canvas.addEventListener('wheel', function (event) {
        event.preventDefault(); // Prevents the default scrolling behavior
        radius += event.deltaY / 100;
        // clamp the radius to [0, 10]
        radius = Math.max(0.1, Math.min(30, radius));
        // update eye positions with new radius
        eyePosition[0] = radius * Math.cos(azimuth) * Math.cos(elevation) + focusPosition[0];
        eyePosition[2] = radius * Math.sin(azimuth) * Math.cos(elevation) + focusPosition[2];
        eyePosition[1] = radius * Math.sin(elevation) + focusPosition[1];
    },{ passive: false });

    canvas.addEventListener('mouseleave', function (event) {
        isMouseDown = false;
    });
    

    image.src = "img/house.png";
}

function bicycleMain() {
    loadSplatFile('./bicycle.splat', renderMain);
}


export { renderMain, loadSplatFile, bicycleMain };
