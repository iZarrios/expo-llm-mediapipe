package expo.modules.llmmediapipe

import android.content.Context
import android.net.Uri
import com.google.mediapipe.tasks.genai.llminference.GraphOptions
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import com.google.mediapipe.tasks.genai.llminference.ProgressListener
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.framework.image.BitmapImageBuilder
import java.io.File
import java.io.InputStream


class LlmInferenceModel(
    private var context: Context,
    private val modelPath: String,
    val maxTokens: Int,
    val topK: Int,
    val temperature: Float,
    val randomSeed: Int,
    val multiModal: Boolean,
    val inferenceListener: InferenceListener? = null,
) {
    private var llmInference: LlmInference
    private var llmInferenceSession: LlmInferenceSession

    // For tracking current request
    private var requestId: Int = 0
    private var requestResult: String = ""
    
    init {
        System.out.println("hello init");

        // Create the LLM engine
        val inferenceOptions = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(modelPath)
            .setMaxTokens(maxTokens)
            .setMaxNumImages(1)
            .build()

        try {
            llmInference = LlmInference.createFromOptions(context, inferenceOptions)
            inferenceListener?.logging(this, "LLM inference engine created successfully")
        } catch (e: Exception) {
            inferenceListener?.logging(this, "Error creating LLM inference engine: ${e.message}")
            throw e
        }

        // Create a session with the specified parameters
        val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTemperature(temperature)
            .setTopK(topK)
            .setGraphOptions(GraphOptions.builder().setEnableVisionModality(multiModal).build())
            .build()

        try {
            llmInferenceSession = LlmInferenceSession.createFromOptions(llmInference, sessionOptions)
            inferenceListener?.logging(this, "LLM inference session created successfully")
        } catch (e: Exception) {
            inferenceListener?.logging(this, "Error creating LLM inference session: ${e.message}")
            llmInference.close()
            throw e
        }
    }

    /**
     * Generates text asynchronously with streaming results via callback
     */
    fun generateResponseAsync(requestId: Int, prompt: String, imagePath:String , callback: (String) -> Unit) {
        System.out.println("hello async generate response");
        this.requestId = requestId
        this.requestResult = ""
        
        try {
            // Reset the session for a new query
            llmInferenceSession.close()
            
            // Create a new session with the same parameters
            val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
                .setTemperature(temperature)
                .setTopK(topK)
                .setGraphOptions(GraphOptions.builder().setEnableVisionModality(multiModal).build())
                .build()
                
            llmInferenceSession = LlmInferenceSession.createFromOptions(llmInference, sessionOptions)
            
            llmInferenceSession.addQueryChunk(prompt)
            // Add the prompt to the session
            if (multiModal == true && imagePath.length > 0) {
                val imageUri = Uri.parse(imagePath)
                val inputStream: InputStream = context.contentResolver.openInputStream(imageUri)!! // !! is used to assert non-null, common when skipping error handling
                val bitmap: Bitmap = BitmapFactory.decodeStream(inputStream)!! // !! asserts non-null
                // Close the input stream immediately after decoding the bitmap
                inputStream.close()

                // Pass the 'bitmap' variable that was just created to BitmapImageBuilder
                val mpImage: MPImage = BitmapImageBuilder(bitmap).build()

                llmInferenceSession.addImage(mpImage)
            }
            
            // Define the progress listener for streaming results
            val progressListener = ProgressListener<String> { result, isFinished ->
                // Send each partial result immediately through the listener
                inferenceListener?.onResults(this, requestId, result)
                
                // Only append to cumulative result and call callback on completion
                requestResult += result
                
                if (isFinished) {
                    callback(requestResult)
                }
            }
            
            // Generate the response asynchronously
            llmInferenceSession.generateResponseAsync(progressListener)
        } catch (e: Exception) {
            inferenceListener?.onError(this, requestId, e.message ?: "")
            callback("")
        }
    }
    
    /**
     * Generates text synchronously and returns the complete response
     */
    fun generateResponse(requestId: Int, prompt: String, imagePath: String): String {
        System.out.println("hello generate response");
        this.requestId = requestId
        this.requestResult = ""
        
        return try {
            // Reset the session for a new query
            llmInferenceSession.close()
            
            // Create a new session with the same parameters
            val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
                .setTemperature(temperature)
                .setTopK(topK)
                .setGraphOptions(GraphOptions.builder().setEnableVisionModality(multiModal).build())
                .build()
                
            llmInferenceSession = LlmInferenceSession.createFromOptions(llmInference, sessionOptions)
            
            // Add the prompt to the session
            llmInferenceSession.addQueryChunk(prompt)

            val imageUri = Uri.parse(imagePath)
            val inputStream: InputStream = context.contentResolver.openInputStream(imageUri)!! // !! is used to assert non-null, common when skipping error handling
            val bitmap: Bitmap = BitmapFactory.decodeStream(inputStream)!! // !! asserts non-null
            // Close the input stream immediately after decoding the bitmap
            inputStream.close()

            // Pass the 'bitmap' variable that was just created to BitmapImageBuilder
            val mpImage: MPImage = BitmapImageBuilder(bitmap).build()

            if (multiModal) {
                llmInferenceSession.addImage(mpImage)
            }
            
            val stringBuilder = StringBuilder()

            // Generate the response synchronously
            val result = llmInferenceSession.generateResponse()
            stringBuilder.append(result)
            
            stringBuilder.toString()
        } catch (e: Exception) {
            inferenceListener?.onError(this, requestId, e.message ?: "")
            throw e
        }
    }
    
    /**
     * Close resources when no longer needed
     */
    fun close() {
        System.out.println("hello close");
        try {
            llmInferenceSession.close()
            llmInference.close()
        } catch (e: Exception) {
            // Ignore close errors
            inferenceListener?.logging(this, "Error closing resources: ${e.message}")
        }
    }
}

interface InferenceListener {
    fun logging(model: LlmInferenceModel, message: String)
    fun onError(model: LlmInferenceModel, requestId: Int, error: String)
    fun onResults(model: LlmInferenceModel, requestId: Int, response: String)
}