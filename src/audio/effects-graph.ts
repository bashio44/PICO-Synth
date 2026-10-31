import {
  effectNames,
  type EffectConfiguration,
  type EffectId,
  type EffectSettingsById,
  type RoutingEdge,
  type WetSettings,
  validateEffects,
  validateRouting
} from "../model/effects";

interface EffectUnit {
  input: GainNode;
  output: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}

export class EffectsGraphBuilder {
  private units = new Map<EffectId, EffectUnit>();
  private send: GainNode | null = null;
  private input: GainNode | null = null;

  rebuild(context: AudioContext, input: GainNode, destination: AudioNode, effects: EffectConfiguration, routing: RoutingEdge[]): void {
    const effectsError = validateEffects(effects);
    if (effectsError) throw new Error(effectsError);
    const routingError = validateRouting(routing);
    if (routingError) throw new Error(routingError);

    const newUnits = new Map<EffectId, EffectUnit>();
    let newSend: GainNode | null = null;
    try {
      const routedEffects = new Set(
        routing.flatMap(({ from, to }) => [from, to]).filter((id): id is EffectId => id in effectNames)
      );
      for (const id of routedEffects) {
        newUnits.set(id, this.createEffect(context, id, effects[id] as EffectSettingsById[typeof id]));
      }
      newSend = context.createGain();
      newSend.gain.value = 0.32;
      this.dispose();

      const fromNode = (id: string): AudioNode => {
        if (id === "input") return input;
        if (id === "send") return newSend!;
        return newUnits.get(id as EffectId)!.output;
      };
      const toNode = (id: string): AudioNode => {
        if (id === "output") return destination;
        if (id === "send") return newSend!;
        return newUnits.get(id as EffectId)!.input;
      };
      input.disconnect();
      for (const edge of routing) fromNode(edge.from).connect(toNode(edge.to));
      this.units = newUnits;
      this.send = newSend;
      this.input = input;
    } catch (error) {
      input.disconnect();
      for (const unit of newUnits.values()) this.disconnectUnit(unit);
      if (newSend) newSend.disconnect();
      for (const edge of routing) {
        if (edge.from === "input") continue;
        try {
          newUnits.get(edge.from as EffectId)?.output.disconnect();
        } catch (disconnectError) {
          console.error("Could not clear a partially built effect route:", disconnectError);
        }
      }
      throw error;
    }
  }

  dispose(): void {
    this.input?.disconnect();
    for (const unit of this.units.values()) this.disconnectUnit(unit);
    this.send?.disconnect();
    this.units.clear();
    this.send = null;
    this.input = null;
  }

  private createEffect<K extends EffectId>(context: AudioContext, id: K, config: EffectSettingsById[K]): EffectUnit {
    const input = context.createGain();
    const output = context.createGain();
    const nodes: AudioNode[] = [input, output];
    const sources: AudioScheduledSourceNode[] = [];
    if (!config.enabled) {
      input.connect(output);
      return { input, output, nodes, sources };
    }

    if (id === "compressor") {
      const params = config as EffectSettingsById["compressor"];
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = params.threshold;
      compressor.ratio.value = params.ratio;
      compressor.knee.value = params.knee;
      compressor.attack.value = params.attack;
      compressor.release.value = params.release;
      input.connect(compressor);
      compressor.connect(output);
      nodes.push(compressor);
      return { input, output, nodes, sources };
    }

    const mixConfig = config as WetSettings;
    const wet = context.createGain();
    const dry = context.createGain();
    dry.gain.value = 1 - mixConfig.wet;
    wet.gain.value = mixConfig.wet;
    input.connect(dry);
    dry.connect(output);
    nodes.push(dry, wet);

    let processor: AudioNode;
    let outputProcessor: AudioNode;
    switch (id) {
      case "distortion": {
        const params = config as EffectSettingsById["distortion"];
        const shaper = context.createWaveShaper();
        shaper.curve = this.distortionCurve(params.drive);
        shaper.oversample = "2x";
        processor = shaper;
        const tone = context.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = Math.min(params.tone, context.sampleRate / 2);
        shaper.connect(tone);
        nodes.push(shaper, tone);
        outputProcessor = tone;
        break;
      }
      case "chorus": {
        const params = config as EffectSettingsById["chorus"];
        const delay = context.createDelay(0.1);
        delay.delayTime.value = 0.05;
        const lfo = context.createOscillator();
        const depth = context.createGain();
        lfo.type = "sine";
        lfo.frequency.value = params.rate;
        depth.gain.value = params.depth;
        lfo.connect(depth);
        depth.connect(delay.delayTime);
        lfo.start();
        sources.push(lfo);
        processor = delay;
        outputProcessor = processor;
        nodes.push(delay, depth);
        break;
      }
      case "eq": {
        const params = config as EffectSettingsById["eq"];
        const filters = params.bands.filter((band) => band.enabled).map((band) => {
          const filter = context.createBiquadFilter();
          filter.type = band.type;
          filter.frequency.value = Math.min(band.frequency, context.sampleRate / 2);
          filter.Q.value = band.q;
          filter.gain.value = band.gain;
          nodes.push(filter);
          return filter;
        });
        if (filters.length === 0) {
          input.connect(wet);
        } else {
          input.connect(filters[0]);
          for (let index = 1; index < filters.length; index++) filters[index - 1].connect(filters[index]);
          filters[filters.length - 1].connect(wet);
        }
        wet.connect(output);
        return { input, output, nodes, sources };
      }
      case "delay": {
        const params = config as EffectSettingsById["delay"];
        const delay = context.createDelay(2);
        const feedback = context.createGain();
        delay.delayTime.value = params.time;
        feedback.gain.value = Math.min(0.8, params.feedback);
        delay.connect(feedback);
        feedback.connect(delay);
        processor = delay;
        outputProcessor = processor;
        nodes.push(delay, feedback);
        break;
      }
      case "reverb": {
        const params = config as EffectSettingsById["reverb"];
        const convolver = context.createConvolver();
        convolver.buffer = this.createImpulse(context, params.decay);
        const preDelay = context.createDelay(0.2);
        preDelay.delayTime.value = params.preDelay;
        processor = preDelay;
        outputProcessor = convolver;
        preDelay.connect(convolver);
        nodes.push(preDelay, convolver);
        break;
      }
      default:
        throw new Error(`エフェクト「${id}」はまだ利用できません。`);
    }
    input.connect(processor);
    outputProcessor.connect(wet);
    wet.connect(output);
    return { input, output, nodes, sources };
  }

  private distortionCurve(drive: number) {
    const amount = Math.max(0, Math.min(100, drive));
    const samples = 44_100;
    const curve = new Float32Array(samples);
    const k = amount * 3;
    const scale = Math.tanh(1 + k);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh((1 + k) * x) / scale;
    }
    return curve;
  }

  private createImpulse(context: AudioContext, decay: number): AudioBuffer {
    const length = Math.floor(context.sampleRate * decay);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
      }
    }
    return impulse;
  }

  private disconnectUnit(unit: EffectUnit): void {
    for (const node of unit.nodes) node.disconnect();
    for (const source of unit.sources) {
      try {
        source.stop();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
      }
      source.disconnect();
    }
  }
}
