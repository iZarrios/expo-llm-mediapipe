import React, { useState, useEffect, useRef } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Button,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
} from 'react-native';
import ExpoLlmMediapipe, {
  NativeModuleSubscription,
  PartialResponseEventPayload,
  ErrorResponseEventPayload,
} from 'expo-llm-mediapipe';


const Yes = () => {
  const [modelHandle, setModelHandle] = useState<number | undefined>();
  const [prompt, setPrompt] = useState<string>('Explain "Large Language Model" in one sentence.');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [response, setResponse] = useState<string>('');
  const [streamingResponse, setStreamingResponse] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoadingAction, setIsLoadingAction] = useState<boolean>(false);
  const [modelPath, setModelPath] = useState<string | null>(null);


  const nextRequestIdRef = useRef(0);
  const streamingListenersRef = useRef<NativeModuleSubscription[]>([]);

  const clearStreamingListeners = () => {
    streamingListenersRef.current.forEach(sub => sub.remove());
    streamingListenersRef.current = [];
  };


  useEffect(() => {
    // Effect to release model when modelHandle changes (e.g., set to undefined) or on unmount
    const currentModelHandle = modelHandle;
    return () => {
      if (currentModelHandle !== undefined) {
        ExpoLlmMediapipe.releaseModel(currentModelHandle)
          .then(() => console.log(`[HooklessDownloadable] Model ${currentModelHandle} released.`))
          .catch(e => console.error(`[HooklessDownloadable] Error releasing model ${currentModelHandle}:`, e));
      }
    };
  }, [modelHandle]);




  const handleLoadModel = async () => {
    if (modelHandle !== undefined) {
      Alert.alert("Model Already Loaded", `Handle: ${modelHandle}`);
      return;
    }
    setIsLoadingAction(true);
    setError('');
    try {
      if (!modelPath) {
        console.log("modelPath is null")
        return;
      }
      console.log("trying to createModel from Path")
      const handle = await ExpoLlmMediapipe.createModel(
        modelPath,
        1024, // maxTokens
        3,    // topK
        0.7,  // temperature
        123, // random seed
        true, // multimodal
      );
      setModelHandle(handle);
      console.log("Model Loaded");
    } catch (e: any) {
      setError(`Load Model Error: ${e.message}`);
      setModelHandle(undefined);
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleReleaseModel = async () => {
    if (modelHandle === undefined) {
      Alert.alert("No Model Loaded", "There is no model to release.");
      return;
    }
    setIsLoadingAction(true);
    try {
      await ExpoLlmMediapipe.releaseModel(modelHandle);
      Alert.alert("Model Released", `Model with handle ${modelHandle} has been released.`);
      setModelHandle(undefined); // This will trigger the useEffect for model release
    } catch (e: any) {
      setError(`Release Model Error: ${e.message}`);
    } finally {
      setIsLoadingAction(false);
    }
  };
  const pickFile = async (): Promise<string | null> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: false,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const fileUri = result.assets[0].uri;
      const fileName = result.assets[0].name;
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        return null;
      } else {
        let destPath = FileSystem.documentDirectory + fileName;
        console.log('Copying file to:', destPath);
        await FileSystem.copyAsync({ from: fileUri, to: destPath });
        console.log('File copied to:', destPath);

        // if (destPath.startsWith('file://')) destPath = destPath.slice(7)

        return destPath;
      }
    } else {
      return null;
    }
  };

  const handlePickFileModel = async () => {
    let path = await pickFile();
    if (path && path.startsWith('file://')) path = path.slice(7)
    setModelPath(path);
  };
  const handlePickFileImage = async () => {
    const path = await pickFile();
    setImagePath(path);
  };



  const handleGenerateResponse = async () => {
    if (modelHandle === undefined) {
      setError('Model is not loaded.');
      return;
    }
    setIsLoadingAction(true);
    setResponse('');
    setStreamingResponse('');
    setError('');
    const requestId = nextRequestIdRef.current++;
    try {
      const result = await ExpoLlmMediapipe.generateResponse(modelHandle, requestId, prompt, imagePath ?? '');
      setResponse(result);
    } catch (e: any) {
      setError(`Generate Response Error: ${e.message}`);
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleGenerateStreamingResponse = async () => {
    if (modelHandle === undefined) {
      setError('Model is not loaded.');
      return;
    }
    setIsLoadingAction(true);
    setResponse('');
    setStreamingResponse('');
    setError('');

    clearStreamingListeners(); // Clear only previous streaming listeners

    const currentRequestId = nextRequestIdRef.current++;
    let accumulatedResponse = "";

    const partialSub = ExpoLlmMediapipe.addListener("onPartialResponse", (ev: PartialResponseEventPayload) => {
      if (ev.handle === modelHandle && ev.requestId === currentRequestId) {
        accumulatedResponse += ev.response;
        setStreamingResponse(accumulatedResponse);
      }
    });
    streamingListenersRef.current.push(partialSub);

    const errorSub = ExpoLlmMediapipe.addListener("onErrorResponse", (ev: ErrorResponseEventPayload) => {
      if (ev.handle === modelHandle && ev.requestId === currentRequestId) {
        setError(`Streaming Error (Request ${ev.requestId}): ${ev.error}`);
        setIsLoadingAction(false);
        clearStreamingListeners();
      }
    });
    streamingListenersRef.current.push(errorSub);

    try {
      await ExpoLlmMediapipe.generateResponseAsync(modelHandle, currentRequestId, prompt, imagePath ?? '');
      // If successful, promise resolves after all parts.
      // isLoadingAction will be set to false in the finally block.
    } catch (e: any) {
      setError(`Generate Streaming Error: ${e.message}`);
      setIsLoadingAction(false);
      clearStreamingListeners();
    } finally {
      // This ensures isLoadingAction is false if the promise resolved without error event,
      // or if it was an error not caught by the listener but by the promise rejection.
      setIsLoadingAction(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Yes</Text>

      <View style={styles.section}>
        <View style={styles.buttonContainer}>
          <Button
            title="Set Model Path"
            onPress={handlePickFileModel}
          />
        </View>
        <View style={styles.buttonContainer}>
          <Button
            title="Load model from path"
            onPress={handleLoadModel}
            disabled={modelPath == null}
          />
        </View>
        <View style={styles.buttonContainer}>
          <Button
            title="Release Model"
            onPress={handleReleaseModel}
            disabled={isLoadingAction || modelHandle === undefined}
          />
        </View>
        <View style={styles.buttonContainer}>
          <Button
            title="Set image path"
            onPress={handlePickFileImage}
          />
        </View>
        {modelHandle !== undefined && <Text style={styles.successText}>Model loaded! Handle: {modelHandle}</Text>}
        {modelPath !== null ? <Text style={styles.successText}>model path: {modelPath}</Text> : <Text style={styles.successText}>model path: empty</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inference</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your prompt"
          value={prompt}
          onChangeText={setPrompt}
          multiline
        />
        {imagePath ? <View style={styles.container}>
          <Image
            source={{ uri: imagePath }} // Adjust path relative to your component file
            style={styles.image}
          />
        </View> :

          <View style={styles.container}>
            <Text>No Image</Text>

          </View>
        }
        <View style={styles.buttonContainer}>
          <Button
            title="Generate Response (One-Shot)"
            onPress={handleGenerateResponse}
            disabled={isLoadingAction || modelHandle === undefined}
          />
        </View>
        <View style={styles.buttonContainer}>
          <Button
            title="Generate Streaming Response"
            onPress={handleGenerateStreamingResponse}
            disabled={isLoadingAction || modelHandle === undefined}
          />
        </View>
      </View>

      {isLoadingAction && <ActivityIndicator style={styles.loader} size="large" />}
      {error && <Text style={[styles.errorText, styles.responseText]}>Error: {error}</Text>}
      {response && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Full Response:</Text>
          <Text style={styles.responseText}>{response}</Text>
        </View>
      )}
      {streamingResponse && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Streaming Response:</Text>
          <Text style={styles.responseText}>{streamingResponse}</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  image: {
    width: 200, // Important: Always set dimensions for local images
    height: 200,
    resizeMode: 'contain', // How the image should fit its container
  },
  contentContainer: {
    padding: 15,
  },
  centeredMessage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  section: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#444',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    marginVertical: 5,
  },
  responseText: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#e9e9e9',
    borderRadius: 5,
    color: '#333',
    fontSize: 14,
  },
  errorText: {
    color: 'red',
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5,
  },
  successText: {
    color: 'green',
    fontWeight: 'bold',
    marginTop: 5,
  },
  loader: {
    marginVertical: 20,
  }
});

export default Yes;
