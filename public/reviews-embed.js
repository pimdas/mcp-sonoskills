const widget=document.querySelector('.elfsight-app-f4646092-c699-4ab4-9aa0-c0a27c889050');
let previous=0;
const resize=()=>{const height=Math.ceil(Math.max(180,widget.getBoundingClientRect().height+16));if(height!==previous){previous=height;parent.postMessage({type:'sonoskills-review-height',height},'*');}};
new ResizeObserver(resize).observe(widget);resize();
