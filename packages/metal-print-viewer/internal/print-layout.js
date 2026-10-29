/* Physical layout extracted from the Metavista browser/server shared geometry. */
export const positions=['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right'];
export function mounts(spec) {
    const {widthCm:w,heightCm:h,size,mount}=spec;
    const two=size==='XL',side=Math.min(w,h)*(two?.20:mount==='magnet'?.24:.38);
    const centers=two?(h>=w?[[.5,.25],[.5,.75]]:[[.25,.5],[.75,.5]]):[[.5,.5]];
    return centers.map(([x,y])=>({x:x*w-side/2,y:y*h-side/2,w:side,h:side}));
  }
export function config(value) {
    if(value==null)return null;
    if(typeof value!=='object'||Array.isArray(value)||typeof value.text!=='string')throw Error('invalid_back_text');
    const text=value.text.replace(/\r\n?/g,'\n').trim();
    if(!text)return null;
    if([...text].length>180||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw Error('invalid_back_text');
    const position=value.position||'bottom-center',fontMm=value.fontMm??10;
    // Preserve existing saved carts and production files; new choices are 1, 3 and 5 cm.
    if(!positions.includes(position)||![4,5,6,8,10,30,50].includes(fontMm))throw Error('invalid_back_text');
    return {text,position,fontMm};
  }
export function intersects(a,b,gap=.8) {return a.x<b.x+b.w+gap&&a.x+a.w>b.x-gap&&a.y<b.y+b.h+gap&&a.y+a.h>b.y-gap;}
export function layout(value,spec) {
    let cfg;try{cfg=config(value)}catch{return {ok:false,error:'invalid_back_text'}}
    if(!cfg)return {ok:true,config:null,lines:[],mounts:mounts(spec)};
    const {widthCm:w,heightCm:h}=spec;
    if(!(w>=10&&h>=10&&w<=150&&h<=150))return {ok:false,error:'invalid_back_text'};
    const em=cfg.fontMm/10,margin=1,maxW=cfg.fontMm>=10?w-2*margin:Math.min(24,w-2*margin),col=Math.max(1,Math.floor(maxW/(em*1.12)));
    const lines=[];
    for(const paragraph of cfg.text.split('\n')) {
      let line='';
      for(const word of paragraph.split(/\s+/)) {
        const chars=[...word];
        if(line&&[...line].length+1+chars.length>col){lines.push(line);line=''}
        while(chars.length>col){if(line){lines.push(line);line=''}lines.push(chars.splice(0,col).join(''))}
        if(chars.length)line+=(line?' ':'')+chars.join('');
      }
      lines.push(line);
    }
    const bw=Math.max(em,...lines.map(s=>[...s].length*em*1.12)),bh=lines.length*em*1.5;
    const [v,a]=cfg.position.split('-');
    const box={x:a==='left'?margin:a==='right'?w-margin-bw:(w-bw)/2,y:v==='top'?margin:v==='bottom'?h-margin-bh:(h-bh)/2,w:bw,h:bh};
    const hardware=mounts(spec),ok=box.x>=margin-.001&&box.y>=margin-.001&&box.x+bw<=w-margin+.001&&box.y+bh<=h-margin+.001&&!hardware.some(m=>intersects(box,m));
    return {ok,error:ok?null:'back_text_overlap',config:cfg,box,lines,mounts:hardware,em,lineHeight:em*1.5,align:a};
  }
export function exportSize(spec) {const scale=Math.min(300/2.54,6000/Math.max(spec.widthCm,spec.heightCm));return {width:Math.round(spec.widthCm*scale),height:Math.round(spec.heightCm*scale)}}
